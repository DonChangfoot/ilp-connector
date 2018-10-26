var Ildcp = require("ilp-protocol-ildcp");

var IlpPacket = require("ilp-packet");

var compat = require("ilp-compat-plugin");
var createLogger = require("../src/common/log");
var Config = require("../src/services/config");
var Store = require("../src/services/store");
var async = require('async');
const reduct = require('reduct')
const crypto = require('crypto')
function sha256 (preimage) { return crypto.createHash('sha256').update(preimage).digest() }
const fulfillment = crypto.randomBytes(32)
const condition = sha256(fulfillment)

const IlpGrpc = require('ilp-grpc')

var user;
if (process.argv.length >= 3) {
    user = process.argv[2];
} else {
    user = 'world';
}

const newAccountData = {
    id: user,
    info: {
        relation: 'child',
        assetScale: 6,
        assetCode: 'XRP',
        plugin: 'ilp-plugin-mirror',
        options: {
            info: {
                prefix: 'test.quickstart.' + user,
                grpcAddress: '0.0.0.0:50052',
            },
            account: 'test.quickstart.' + user + '.connector',
            balance: '0'
        }
    },
};


const deps = reduct();

// this.config = deps(Config)
// this.store = deps(Store)


const Plugin = require(newAccountData.info.plugin)

const api = {}
// Lazily create plugin utilities
Object.defineProperty(api, 'store', {
    get: () => {
        return this.store.getPluginStore(newAccountData.id)
    }
})
Object.defineProperty(api, 'log', {
    get: () => {
        return createLogger(`${newAccountData.info.plugin}[${newAccountData.id}]`)
    }
})

const opts = {}
// Provide old deprecated _store and _log properties
Object.defineProperty(opts, '_store', {
    get: () => {
        log.warn('DEPRECATED: plugin accessed deprecated _store property. accountId=%s', accountId)
        return api.store
    }
})
Object.defineProperty(opts, '_log', {
    get: () => {
        log.warn('DEPRECATED: plugin accessed deprecated _log property. accountId=%s', accountId)
        return api.log
    }
})

const plugin = compat(new Plugin(opts, api))

async function main() {

    let client = new IlpGrpc.default({
        server: "0.0.0.0:5505",
        accountId: newAccountData.id,
        accountOptions: newAccountData.info,
        dataHandler: (from, data) =>{
            console.log('from', from   , 'data', data  )
            return IlpPacket.serializeIlpFulfill({
                    fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
                data: Buffer.from('thank you')
            })}
    })

    await client.connect()

    async.series([
        function runAddAccount(callback) {

            client.addAccount(newAccountData).then(() => callback(null, "I got added to connector's accounts")).catch((error) => {console.log('error', error); callback(null, "I did not get added to connector's accounts")});

        },
        function runChangeConnectionStatus(callback){

            client.updateConnectionStatus(true).then(() => callback(null, "Connection status changed")).catch((error) => {console.log('error', error); callback(null, "could not change connection status")})

        },
        // function runDataHandleTest(callback) {
        //
        //    client.sendData(IlpPacket.serializeIlpPrepare({
        //        amount: '10',
        //        expiresAt: new Date(),
        //        executionCondition: Buffer.alloc(32),
        //        destination: 'test.quickstart.' + user,
        //        data: Buffer.from('hello world')
        //    })).then(data => callback(null, IlpPacket.deserializeIlpPrepare(data))).catch((error) => {console.log('error', error); callback(null, "failed to send data")})
        //
        // }
        // runRemoveAccount,
    ], function(err, results){console.log(results)})

}

main();
