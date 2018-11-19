import {AccountInfo} from "./accounts"
import {MoneyHandler, DataHandler} from "./plugin"

export interface AccountServiceConstructor {
  new (accountId: string, accountInfo: AccountInfo, optArgs: any): AccountServiceInstance
}

export interface AccountServiceInstance {
  setupMiddleware(),
  registerConnectHandler (handler: (args: any[]) => void),
  deregisterConnectHandler(),
  registerDisconnectHandler (handler: (args: any[]) => void),
  deregisterDisconnectHandler(),
  registerDataHandler(handler: DataHandler),
  deregisterDataHandler (),
  registerMoneyHandler(handler: MoneyHandler),
  deregisterMoneyHandler (),
  sendData(data: Buffer): Promise<Buffer>,
  isConnected() : boolean,
  connect(),
  disconnect(),
  getInfo(): AccountInfo,
}