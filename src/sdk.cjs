// Select the official CommonJS builds to avoid their transitive ESM named-BN
// import incompatibility on Node 22. Bundlers resolve these static requires.
module.exports = {
  pump: require('@pump-fun/pump-sdk'),
  swap: require('@pump-fun/pump-swap-sdk'),
};
