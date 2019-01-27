'use strict';

const fs = require('fs');
const path = require('path');
const enterSandbox = require('./build/seccomp.node');

const sourceFilesEncoded = fs.readFileSync(path.join(__dirname, 'eslint.bundle'));
const configPath = path.resolve('.eslintrc.json');
const configJSON = fs.readFileSync(configPath, 'utf8');

if (enterSandbox() !== true) {
	throw new Error('Failed to enter sandbox');
}

{
	let error = null;

	try {
		fs.statSync(__filename);
	} catch (error_) {
		error = error_;
	}

	if (error === null || error.code !== 'ENOSYS') {
		throw new Error('Sandbox reported success but doesn’t work!');
	}
}

const sourceFiles = new Map();

for (let i = 0; i < sourceFilesEncoded.length;) {
	const readOne = () => {
		let length = sourceFilesEncoded.readInt32BE(i);
		const flag = Boolean(length & 0x80000000);
		length &= ~0x80000000;

		i += 4;

		if (i + length > sourceFilesEncoded.length) {
			throw new Error('Invalid bundle');
		}

		const string = sourceFilesEncoded.toString('utf8', i, i += length);

		return [string, flag];
	};

	let [relativePath, isLeaf] = readOne();
	const dependencyPaths = new Map();

	while (!isLeaf) {
		let dependencyPath;
		[dependencyPath, isLeaf] = readOne();

		const [resolved] = readOne();
		dependencyPaths.set(dependencyPath, resolved);
	}

	const [content] = readOne();

	sourceFiles.set(relativePath, {
		content,
		dependencyPaths,
	});
}

const Module = module.constructor;
const sourceModules = new Map();
const fakePrefix = path.join(__dirname, 'node_modules');

const getModule = (relativePath, parent) => {
	let exports = sourceModules.get(relativePath);

	if (exports !== undefined) {
		return exports;
	}

	const {content, dependencyPaths} = sourceFiles.get(relativePath);

	if (relativePath.endsWith('.json')) {
		exports = JSON.parse(content);
		sourceModules.set(relativePath, exports);
		return exports;
	}

	const absolutePath = path.join(fakePrefix, relativePath);
	const sourceModule = new Module(absolutePath, parent);

	// support circular dependencies, like glob
	exports = sourceModule.exports;
	sourceModules.set(relativePath, exports);

	sourceModule.require = function (id) {
		const override = dependencyPaths.get(id);

		if (override !== undefined) {
			return getModule(override, this);
		}

		return Module.prototype.require.call(this, id);
	};
	sourceModule._compile(content, absolutePath);

	exports = sourceModule.exports;
	sourceModules.set(relativePath, exports);
	return exports;
};

const originalReadFileSync = fs.readFileSync;

fs.readFileSync = (p, options) =>
	p === configPath && options === 'utf8' ?
		configJSON :
		originalReadFileSync(p, options);

sourceModules.set('eslint/node_modules/import-fresh/index.js', moduleId => {
	if (moduleId === path.join(fakePrefix, 'eslint/conf/eslint-recommended.js')) {
		return getModule('eslint/conf/eslint-recommended.js', null);
	}

	return require(moduleId);
});

getModule('eslint/bin/eslint.js', null);
