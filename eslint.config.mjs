import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from '@eslint-react/eslint-plugin';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['out/*', 'src/3rdparty/*', 'src/js/3rdparty/*', 'src/js/lib/test/mocha.js'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  reactPlugin.configs.recommended,
  {
    plugins: {
      import: importPlugin,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.nodeBuiltin,
        ...globals.es2015,
        ...globals.node,
      },
      parserOptions: {
        project: ['./tsconfig.json'],
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
        ecmaVersion: 'latest',
      },
    },
    settings: {
      'import/resolver': { typescript: {} },
    },
    rules: {
      'import/extensions': ['error', 'ignorePackages', {
        js: 'always',
        cjs: 'always',
        ts: 'never',
        cts: 'never',
        jsx: 'never',
        tsx: 'never',
      }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-use-before-define': 'off',
      '@typescript-eslint/no-use-before-define': ['error', {
        functions: false,
        classes: false,
        variables: true,
      }],
      'camelcase': 'off',                    // want to be able to use g_xxx and s_xxx
      'key-spacing': ['error', { beforeColon: false, afterColon: true, mode: 'minimum' }],
      'arrow-body-style': ['error', 'as-needed'],
      'no-underscore-dangle': 'off',          // used for private members
      'no-lone-blocks': 'off',                // I like to organize my code!
      'no-console': 'off',
      '@eslint-react/no-unused-class-component-members': 'off', // too many false positives with public API methods
      '@typescript-eslint/no-empty-function': 'off',
      'import/no-useless-path-segments': 'off', // buggy, gives bad results
      'import/prefer-default-export': 'off',
      'import/no-import-module-exports': 'off',
      'import/no-relative-packages': 'off',
    },
  },
  {
    files: ['*.test.js'],
    rules: {
      'import/no-extraneous-dependencies': 'off',
    },
  },
);
