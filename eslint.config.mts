import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

// Same rules Obsidian's review bot applies (eslint-plugin-obsidianmd, "recommended").
export default defineConfig(
	globalIgnores(['node_modules', 'dist', 'test-vault', '.scratch', 'scripts', 'tests', 'esbuild.config.mjs', 'version-bump.mjs', 'versions.json', 'vitest.config.ts', 'eslint.config.mts', 'main.js', 'package.json', 'package-lock.json', 'tsconfig.json']),
	{
		languageOptions: {
			globals: { ...globals.browser },
			parserOptions: {
				projectService: { allowDefaultProject: ['manifest.json'] },
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
);
