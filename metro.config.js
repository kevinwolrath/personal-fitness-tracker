// Learn more: https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * Resolve @anthropic-ai/sdk through its CommonJS build ("require" export condition).
 *
 * The SDK's ESM build has an import cycle (beta/messages/messages → BetaToolRunner → resources/beta →
 * beta/messages/index → messages). In development, Metro's React Refresh reads every module's exports
 * as soon as it loads, which hits a `const` in the cycle before it is initialised and crashes the app
 * ("Cannot access 'BETA_BROWSER_MEMBER_NAME_VALUES' before initialization"). The CJS build reads those
 * exports lazily, so the same cycle is harmless. Production bundles were unaffected; dev was not.
 */
const SDK = '@anthropic-ai/sdk';
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolve ?? context.resolveRequest;
  if (moduleName === SDK || moduleName.startsWith(`${SDK}/`)) {
    return resolve({ ...context, unstable_conditionNames: ['require', 'react-native'] }, moduleName, platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
