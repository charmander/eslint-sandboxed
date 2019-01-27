#define NAPI_VERSION 3
#include <node_api.h>

#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

// ENOSYS
#include <errno.h>

// perror
#include <stdio.h>

static napi_value enter_sandbox(napi_env const env, __attribute__ ((unused)) napi_callback_info const cbinfo) {
	if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0UL, 0UL, 0UL) != 0) {
		perror("prctl(PR_SET_NO_NEW_PRIVS) failed");
		return NULL;
	}

	struct sock_filter filter[] = {
		/* validate the syscall’s architecture */
		BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_X86_64, 1, 0),
		BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),

		/* ensure that the syscall isn’t x32… if not using a whitelist */
		BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
		/*BPF_JUMP(BPF_JMP | BPF_JGE | BPF_K, __X32_SYSCALL_BIT, 0, 1),
		BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | ENOSYS),*/

		/* validate the x86-64 OR x32 syscall */
		// TODO: sort by frequency. don’t use a more complex scheme.
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_fstat,          20, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_getpid,         19, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_getcwd,         18, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_fcntl,          17, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_ioctl,          16, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_mmap,           15, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_futex,          14, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_madvise,        13, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_munmap,         12, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_epoll_pwait,    11, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_rt_sigaction,   10, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_rt_sigprocmask,  9, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_close,           8, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_epoll_ctl,       7, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_mprotect,        6, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_brk,             5, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_read,            4, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_write,           3, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_exit,            2, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_exit_group,      1, 0),
		BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | ENOSYS),
		//BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
		BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
	};

	struct sock_fprog prog = {
		.len = (unsigned short)(sizeof filter / sizeof *filter),
		.filter = filter,
	};

	if (syscall(SYS_seccomp, SECCOMP_SET_MODE_FILTER, SECCOMP_FILTER_FLAG_TSYNC, &prog) != 0) {
		perror("Setting seccomp with filter mode failed");
		return NULL;
	}

	napi_value boolean_true;

	if (napi_get_boolean(env, true, &boolean_true) != napi_ok) {
		return NULL;
	}

	return boolean_true;
}

static napi_value init(napi_env const env, __attribute__ ((unused)) napi_value const exports) {
	napi_value export;

	if (napi_create_function(env, "enter_sandbox", NAPI_AUTO_LENGTH, enter_sandbox, NULL, &export) != napi_ok) {
		return NULL;
	}

	return export;
}

NAPI_MODULE(seccomp, init)
