CPPFLAGS = -D_GNU_SOURCE -isystem /usr/include/node
CFLAGS = -std=c11 -pedantic -Wall -Wextra -Os

build/seccomp.node: src/seccomp.c
	$(CC) -shared -fpic $(CPPFLAGS) $(CFLAGS) $< -o $@
	strip $@
