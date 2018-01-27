import reduct = require('reduct')
import { partial } from 'lodash'
import { create as createLogger } from './common/log'
const log = createLogger('app')

import Config from './services/config'
import RouteBuilder from './services/route-builder'
import RouteBroadcaster from './services/route-broadcaster'
import Accounts from './services/accounts'
import RateBackend from './services/rate-backend'
import Store from './services/store'
import MiddlewareManager from './services/middleware-manager'

import { PluginInstance } from './types/plugin'

function listen (
  config: Config,
  accounts: Accounts,
  backend: RateBackend,
  store: Store,
  routeBuilder: RouteBuilder,
  routeBroadcaster: RouteBroadcaster,
  middlewareManager: MiddlewareManager
) {
  // Start a coroutine that connects to the backend and
  // subscribes to all the accounts in the background
  return (async function () {
    try {
      await backend.connect()
    } catch (error) {
      log.error(error)
      process.exit(1)
    }

    await middlewareManager.setup()

    // If we have no configured ILP address, try to get one via ILDCP
    await accounts.loadIlpAddress()

    // Connect other plugins, give up after initialConnectTimeout
    await new Promise((resolve, reject) => {
      const connectTimeout = setTimeout(() => {
        log.warn('one or more accounts failed to connect within the time limit, continuing anyway.')
        resolve()
      }, config.initialConnectTimeout)
      accounts.connect({ timeout: config.initialConnectTimeout })
        .then(() => {
          clearTimeout(connectTimeout)
          resolve()
        }, reject)
    })

    await middlewareManager.startup()

    if (config.routeBroadcastEnabled) {
      await routeBroadcaster.start()
    }

    log.info('connector ready (republic attitude). address=%s', accounts.getOwnAddress())
  })().catch((err) => log.error(err))
}

async function addPlugin (
  config: Config,
  accounts: Accounts,
  backend: RateBackend,
  routeBroadcaster: RouteBroadcaster,
  middlewareManager: MiddlewareManager,

  id: string,
  options: any
) {
  accounts.add(id, options)
  const plugin = accounts.getPlugin(id)
  routeBroadcaster.add(id)
  await middlewareManager.addPlugin(id, plugin)

  await plugin.connect({ timeout: Infinity })
  routeBroadcaster.reloadLocalRoutes()
}

async function removePlugin (
  config: Config,
  accounts: Accounts,
  backend: RateBackend,
  routeBroadcaster: RouteBroadcaster,
  middlewareManager: MiddlewareManager,

  id: string
) {
  const plugin = accounts.getPlugin(id)
  middlewareManager.removePlugin(id, plugin)
  await plugin.disconnect()
  accounts.remove(id)
  routeBroadcaster.remove(id)
  routeBroadcaster.reloadLocalRoutes()
}

function getPlugin (
  accounts: Accounts,

  id: string
) {
  return accounts.getPlugin(id)
}

function shutdown (
  accounts: Accounts,
  routeBroadcaster: RouteBroadcaster
) {
  routeBroadcaster.stop()
  return accounts.disconnect()
}

export default function createApp (opts?: object, container?: reduct.Injector) {
  const deps = container || reduct()

  const config = deps(Config)

  try {
    if (opts) {
      config.loadFromOpts(opts)
    } else {
      config.loadFromEnv()
    }
  } catch (err) {
    if (err.name === 'InvalidJsonBodyError') {
      log.warn('config validation error.')
      err.debugPrint(log.warn)
      log.error('invalid configuration, shutting down.')
      throw new Error('failed to initialize due to invalid configuration.')
    }

    throw err
  }

  const accounts = deps(Accounts)
  const routeBuilder = deps(RouteBuilder)
  const routeBroadcaster = deps(RouteBroadcaster)
  const backend = deps(RateBackend)
  const store = deps(Store)
  const middlewareManager = deps(MiddlewareManager)

  const credentials = config.accounts
  // We have two separate for loops to make the logs look nicer :)
  for (let id of Object.keys(credentials)) {
    accounts.add(id, credentials[id])
  }
  for (let id of Object.keys(credentials)) {
    routeBroadcaster.add(id)
  }

  return {
    config,
    listen: partial(listen, config, accounts, backend, store, routeBuilder, routeBroadcaster, middlewareManager),
    addPlugin: partial(addPlugin, config, accounts, backend, routeBroadcaster, middlewareManager),
    removePlugin: partial(removePlugin, config, accounts, backend, routeBroadcaster, middlewareManager),
    getPlugin: partial(getPlugin, accounts),
    shutdown: partial(shutdown, accounts, routeBroadcaster)
  }
}
