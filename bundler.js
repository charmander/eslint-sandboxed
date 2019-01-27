'use strict';

const fs = require('fs');
const {createRequireFromPath} = require('module');
const path = require('path');
const {inspect} = require('util');

const findRequires = js => {
	const pattern = /\brequire\s*\(\s*['"]([^'"]+)/g;
	const requirePaths = [];
	let match;

	while ((match = pattern.exec(js)) !== null) {
		if (js.lastIndexOf('//', match.index - 2) <= js.lastIndexOf('\n', match.index - 1)) {
			requirePaths.push(match[1]);
		}
	}

	return requirePaths;
};

const rewritePackageJSON = json => {
	const packageData = JSON.parse(json);

	Object.keys(packageData)
		.filter(key => key.startsWith('_'))
		.forEach(key => {
			delete packageData[key];
		});

	return JSON.stringify(packageData);
};

const sourceFiles = new Map();
let pendingCount = 0;

const processSourceFile = (requirePath, containingPath, options) => {
	const absolutePath = createRequireFromPath(containingPath).resolve(requirePath);

	if (absolutePath === requirePath) {
		// built-in module
		return null;
	}

	const override = options.overrides.get(absolutePath) || {};
	override.used = true;

	if (override.ignore) {
		return null;
	}

	if (absolutePath.endsWith('.node')) {
		throw new Error('Unsupported .node require');
	}

	if (!absolutePath.endsWith('.js') && !absolutePath.endsWith('.json')) {
		throw new Error('Unusual require filename: ' + inspect(absolutePath));
	}

	if (sourceFiles.has(absolutePath)) {
		return absolutePath;
	}

	sourceFiles.set(absolutePath, null);
	pendingCount++;

	fs.readFile(absolutePath, 'utf8', (error, content) => {
		if (error) {
			throw error;
		}

		if (path.basename(absolutePath) === 'package.json') {
			content = rewritePackageJSON(content);
		}

		const dependencyPaths = new Map();

		sourceFiles.set(absolutePath, {
			content,
			dependencyPaths,
		});

		const foundRequires =
			absolutePath.endsWith('.json') ?
				[] :
				findRequires(content);

		const {additionalRequires = []} = override;

		for (const potentialDependency of [...foundRequires, ...additionalRequires]) {
			const dependencyAbsolutePath = processSourceFile(potentialDependency, absolutePath, options);

			if (dependencyAbsolutePath !== null) {
				dependencyPaths.set(potentialDependency, dependencyAbsolutePath);
			}
		}

		if (--pendingCount === 0) {
			done(options);
		}
	});

	return absolutePath;
};

const removePrefix = (prefix, s) => {
	if (!s.startsWith(prefix)) {
		throw new Error('String does not have prefix');
	}

	return s.substring(prefix.length);
};

const writeString = (text, flag) => {
	let length = Buffer.byteLength(text, 'utf8');

	if (length >= 0x80000000) {
		throw new RangeError('Text too long');
	}

	if (flag) {
		length |= 0x80000000;
	}

	const lengthBuffer = Buffer.alloc(4);
	lengthBuffer.writeInt32BE(length, 0);
	process.stdout.write(lengthBuffer);
	process.stdout.write(text, 'utf8');
};

const done = ({overrides}) => {
	const prefix = sourceFiles.keys().next().value.replace(/eslint[\\/]bin[\\/]eslint\.js$/, '');

	for (const [absolutePath, sourceFile] of sourceFiles) {
		const relativePath = removePrefix(prefix, absolutePath);
		const {dependencyPaths, content} = sourceFile;

		writeString(relativePath, dependencyPaths.size === 0);

		let i = 0;

		for (const [key, value] of dependencyPaths) {
			writeString(key, ++i === dependencyPaths.size);
			writeString(removePrefix(prefix, value), false);
		}

		writeString(content, false);
	}

	for (const [absolutePath, override] of overrides) {
		if (!override.used) {
			console.warn('Unused override:', absolutePath);
		}
	}
};

const builtinFormatters =
	fs.readdirSync(path.join(__dirname, 'node_modules/eslint/lib/formatters'))
		.filter(name => name.endsWith('.js'))
		.map(name => name.slice(0, -3));

const context = {
	overrides: new Map([
		[path.join(__dirname, 'node_modules/eslint/node_modules/js-yaml/index.js'), {
			ignore: true,
		}],
		[path.join(__dirname, 'node_modules/eslint/lib/cli-engine.js'), {
			additionalRequires: builtinFormatters.map(name => './formatters/' + name),
		}],
		[path.join(__dirname, 'node_modules/eslint/lib/linter.js'), {
			additionalRequires: [
				'espree',
			],
		}],
	]),
};

processSourceFile('eslint/bin/eslint.js', __filename, context);
processSourceFile('eslint/conf/eslint-recommended.js', __filename, context);
