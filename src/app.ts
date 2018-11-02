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
import AdminApi from './services/admin-api'
import * as Prometheus from 'prom-client'
import AccountManager from "./services/account-manager";

function listen (
  config: Config,
  accounts: Accounts,
  backend: RateBackend,
  store: Store,
  routeBuilder: RouteBuilder,
  routeBroadcaster: RouteBroadcaster,
  middlewareManager: MiddlewareManager,
  adminApi: AdminApi,
  accountManager: AccountManager
) {
  // Start a coroutine that connects to the backend and
  // sets up the account manager that will start a grpc server to communicate with accounts
  return (async function () {
    adminApi.listen()

    try {
      await backend.connect()
    } catch (error) {
      log.error(error)
      process.exit(1)
    }

    accountManager.listen()

    await middlewareManager.startup()

    if (config.collectDefaultMetrics) {
      Prometheus.collectDefaultMetrics()
    }

    log.info('connector ready (republic attitude). address=%s', accounts.getOwnAddress())
  })().catch((err) => log.error(err))
}

function shutdown (
  accountManager: AccountManager,
  routeBroadcaster: RouteBroadcaster
) {
  routeBroadcaster.stop()
  accountManager.shutdown()
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
      err.debugPrint(log.warn.bind(log))
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
  const adminApi = deps(AdminApi)
  const accountManager = deps(AccountManager)

  accountManager.registerNewAccountHandler(async (id: string, options: object) => {
    accounts.add(id, options)

    await middlewareManager.addPlugin(id, accountManager)

    await accounts.loadIlpAddress()

    routeBroadcaster.track(id)

  })

  accountManager.registerRemoveAccountHandler(async (id: string) => {

    middlewareManager.removePlugin(id, accountManager)

    routeBroadcaster.untrack(id)

    accounts.remove(id)

    routeBroadcaster.reloadLocalRoutes()

  })

  return {
    config,
    listen: partial(listen, config, accounts, backend, store, routeBuilder, routeBroadcaster, middlewareManager, adminApi, accountManager),
    shutdown: partial(shutdown, accountManager, routeBroadcaster)
  }
}
