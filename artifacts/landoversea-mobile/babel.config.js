module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { unstable_transformImportMeta: true }]],
    // The workspace-hoisted preset cannot see this package's expo-router under
    // pnpm's strict module layout, so include Expo's own Router transform directly.
    plugins: [
      require('babel-preset-expo/build/expo-router-plugin').expoRouterBabelPlugin,
      // Reanimated 4 requires the Worklets transform to run last.
      require('react-native-worklets/plugin'),
    ],
  };
};
