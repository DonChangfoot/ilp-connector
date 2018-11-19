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
import {AccountServiceInstance} from "./types/account-service"

function listen (
  config: Config,
  accounts: Accounts,
  backend: RateBackend,
  store: Store,
  routeBuilder: RouteBuilder,
  routeBroadcaster: RouteBroadcaster,
  middlewareManager: MiddlewareManager,
  adminApi: AdminApi,
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

    await accounts.startup()

    if (config.collectDefaultMetrics) {
      Prometheus.collectDefaultMetrics()
    }

    log.info('connector ready (republic attitude). address=%s', accounts.getOwnAddress())
  })().catch((err) => log.error(err))
}

async function shutdown (
  accounts: Accounts,
  routeBroadcaster: RouteBroadcaster
) {
  routeBroadcaster.stop()
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

  const newAccountHandler =  async  (id: string, accountService: AccountServiceInstance) => {
    await middlewareManager.addAccountService(id, accountService)

    middlewareManager.startup(id)

    await accounts.loadIlpAddress()

    routeBroadcaster.track(id)

    routeBroadcaster.reloadLocalRoutes()
  }

  const removeAccountHandler = (id: string) => {
    middlewareManager.removeAccountService(id)

    routeBroadcaster.untrack(id)

    routeBroadcaster.reloadLocalRoutes()
  }

  accounts.registerNewAccountHandler(newAccountHandler)
  accounts.registerRemoveAccountHandler(removeAccountHandler)

  return {
    config,
    listen: partial(listen, config, accounts, backend, store, routeBuilder, routeBroadcaster, middlewareManager, adminApi),
    shutdown: partial(shutdown, accounts, routeBroadcaster)
  }
}
