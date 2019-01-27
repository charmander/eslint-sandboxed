This is a limited version of ESLint sandboxed with seccomp-bpf.

```shell
make
npm install --ignore-scripts --global-style
node bundler.js
node cli.js --stdin --config .eslintrc.json --no-eslintrc < input.js
```
