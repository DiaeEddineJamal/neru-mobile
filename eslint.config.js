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
    // no-named-as-default(-member) build an export map of every module a file imports, transitively, trying ~35
    // extensions through two resolvers per path: on store.ts (which imports most of the app) lint ran over 4 minutes
    // for that alone. tsc catches a wrong default or named import anyway.
    settings: { "import/ignore": ["node_modules"] },
    rules: { "import/namespace": "off", "import/no-unresolved": "off", "import/no-named-as-default": "off", "import/no-named-as-default-member": "off" },
  },
  {
    // The React Compiler rules compile every function of a file. On plain .ts modules (stores, streaming, parsers)
    // that is all cost and no benefit: store.ts alone took over 4 minutes, 22 s without them. Components live in
    // .tsx, where these rules keep running; the cheap hook checks stay on everywhere.
    files: ["**/*.ts"],
    rules: Object.fromEntries([
      "static-components", "use-memo", "preserve-manual-memoization", "incompatible-library", "immutability", "globals",
      "refs", "set-state-in-effect", "error-boundaries", "purity", "set-state-in-render", "unsupported-syntax", "config", "gating",
    ].map(rule => [`react-hooks/${rule}`, "off"])),
  },
]);
