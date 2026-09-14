// Public re-exports for @devdock/config.
// This package exists to centralize tsconfig/eslint/prettier presets.
//   import preset from '@devdock/config';
//   `extends` is not supported for JS, so consumers either:
//     - Use the `package.json` `exports` field:
//         extends: "@devdock/config/tsconfig.lib.json"
//     - Or import the preset module and apply rules manually.

export const VERSION = '0.1.0';
