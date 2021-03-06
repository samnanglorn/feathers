const Debug = require('debug');
const auth = require('@feathersjs/authentication');

const { rest } = require('@feathersjs/express');
const { _, makeUrl } = require('@feathersjs/commons');

const merge = require('lodash.merge');
const defaultHandler = require('./express/handler');
const defaultErrorHandler = require('./express/error-handler');
const DefaultVerifier = require('./verifier');

const debug = Debug('@feathersjs/authentication-oauth2');

const { omit, pick } = _;
const INCLUDE_KEYS = [
  'entity',
  'service',
  'passReqToCallback',
  'session'
];

const EXCLUDE_KEYS = ['Verifier', 'Strategy', 'formatter'];

// When the OAuth callback is called, req.user will always be null
// The following extracts the user from the jwt cookie if present
// This ensures that the social link happens on an existing user
function _callbackAuthenticator (config) {
  return function (req, res, next) {
    auth.express.authenticate('jwt', config)(req, res, () => {
      // We have to mark this as unauthenticated even though req.user may be set
      // because we still need the OAuth strategy to run in next()
      req.authenticated = false;
      next();
    });
  };
}

function init (options = {}) {
  return function oauth2Auth () {
    const app = this;
    const _super = app.setup;

    if (!app.passport) {
      throw new Error(`Can not find app.passport. Did you initialize feathers-authentication before @feathersjs/authentication-oauth2?`);
    }

    let { name, Strategy } = options;

    if (!name) {
      throw new Error(`You must provide a strategy 'name'.`);
    }

    if (!Strategy) {
      throw new Error(`You must provide a passport 'Strategy' instance.`);
    }

    const authSettings = app.get('auth') || app.get('authentication') || {};

    // Attempt to pull options from the global auth config
    // for this provider.
    const providerSettings = authSettings[name] || {};
    const oauth2Settings = merge({
      idField: `${name}Id`,
      path: `/auth/${name}`,
      __oauth: true
    }, pick(authSettings, ...INCLUDE_KEYS), providerSettings, omit(options, ...EXCLUDE_KEYS));

    // Set callback defaults based on provided path
    oauth2Settings.callbackPath = oauth2Settings.callbackPath || `${oauth2Settings.path}/callback`;
    oauth2Settings.callbackURL = oauth2Settings.callbackURL || makeUrl(oauth2Settings.callbackPath, app);

    if (!oauth2Settings.clientID) {
      throw new Error(`You must provide a 'clientID' in your authentication configuration or pass one explicitly`);
    }

    if (!oauth2Settings.clientSecret) {
      throw new Error(`You must provide a 'clientSecret' in your authentication configuration or pass one explicitly`);
    }

    const Verifier = options.Verifier || DefaultVerifier;
    const formatter = options.formatter || rest.formatter;
    const handler = options.handler || defaultHandler(oauth2Settings);
    const errorHandler = typeof options.errorHandler === 'function' ? options.errorHandler(oauth2Settings) : defaultErrorHandler(oauth2Settings);

    // register OAuth middleware
    debug(`Registering '${name}' Express OAuth middleware`);
    app.get(oauth2Settings.path, auth.express.authenticate(name, omit(oauth2Settings, 'state')));
    app.get(
      oauth2Settings.callbackPath,
      _callbackAuthenticator(authSettings),
      auth.express.authenticate(name, omit(oauth2Settings, 'state')),
      handler,
      errorHandler,
      auth.express.emitEvents(authSettings, app),
      auth.express.setCookie(authSettings),
      auth.express.successRedirect(),
      auth.express.failureRedirect(authSettings),
      formatter
    );

    app.setup = function () {
      let result = _super.apply(this, arguments);
      let verifier = new Verifier(app, oauth2Settings);

      if (!verifier.verify) {
        throw new Error(`Your verifier must implement a 'verify' function. It should have the same signature as a oauth2 passport verify callback.`);
      }

      // Register 'oauth2' strategy with passport
      debug('Registering oauth2 authentication strategy with options:', oauth2Settings);
      app.passport.use(name, new Strategy(oauth2Settings, verifier.verify.bind(verifier)));
      app.passport.options(name, oauth2Settings);

      return result;
    };
  };
}

module.exports = init;

// Exposed Modules
Object.assign(module.exports, {
  default: init,
  Verifier: DefaultVerifier
});
