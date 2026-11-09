// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Generated native projects and build output hold thousands of JS files; linting them made `expo lint` hang.
    ignores: ["dist/*", "android/**", "ios/**", "modules/*/android/build/**", ".expo/**", "**/.omc/**"],
  },
  {
    // eslint-plugin-import parsed lucide-react-native's ~2,000 icon exports (a 26k-line .d.ts) for every file that
    // imports an icon: one file took ~60 s and the whole lint never finished. Don't read packages' export maps.
    // TypeScript (`tsc --noEmit`) already checks namespace imports and unresolved paths; these two rules
    // re-resolved every import and cost ~10 s per file.
    settings: { "import/ignore": ["node_modules"] },
    rules: { "import/namespace": "off", "import/no-unresolved": "off" },
  }
]);
