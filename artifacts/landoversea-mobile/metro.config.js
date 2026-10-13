const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);
const singletonPackages = ['react', 'react-dom', 'react-native'];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const singleton = singletonPackages.find(
    (packageName) => moduleName === packageName || moduleName.startsWith(`${packageName}/`),
  );
  if (singleton) {
    return {
      filePath: require.resolve(moduleName, { paths: [path.resolve(__dirname, 'node_modules')] }),
      type: 'sourceFile',
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
