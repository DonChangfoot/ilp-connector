import {AccountInfo} from "./accounts"
import {MoneyHandler, DataHandler} from "./plugin"

export interface AccountServiceConstructor {
  new (accountId: string, accountInfo: AccountInfo, optArgs: any): AccountServiceInstance
}

export interface AccountServiceInstance {
  setupMiddleware(): void,
  registerConnectHandler (handler: (args: any[]) => void): void,
  deregisterConnectHandler(): void,
  registerDisconnectHandler (handler: (args: any[]) => void): void,
  deregisterDisconnectHandler(): void,
  registerDataHandler(handler: DataHandler): void,
  deregisterDataHandler(): void,
  registerMoneyHandler(handler: MoneyHandler): void,
  deregisterMoneyHandler(): void,
  sendData(data: Buffer): Promise<Buffer>,
  sendMoney(amount: string): Promise<void>,
  isConnected() : boolean,
  connect(): void,
  disconnect(): void,
  getInfo(): AccountInfo,
}