'use strict'
const chai = require('chai')
const assert = chai.assert
chai.use(require('chai-as-promised'))

const appHelper = require('./helpers/app')
const mockRequire = require('mock-require')
const nock = require('nock')
const sinon = require('sinon')
nock.enableNetConnect(['localhost'])
const logger = require('../src/common/log')
const logHelper = require('./helpers/log')
const Peer = require('../src/routing/peer').default
const { serializeCcpRouteUpdateRequest } = require('ilp-protocol-ccp')
const { UnreachableError } = require('ilp-packet').Errors

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

const PluginMock = require('./mocks/mockPlugin')
mockRequire('ilp-plugin-mock', PluginMock)

describe('Account Manager', function () {
  logHelper(logger)

  beforeEach(async function () {
    appHelper.create(this)

    await this.backend.connect()

    sinon.stub(this.accountManager, 'sendData').resolves(Buffer.alloc(0))

    await this.accountManager.newAccountHandler('test.usd-ledger', {
      'relation': 'peer',
      'assetCode': 'USD',
      'assetScale': 4,
      'plugin': 'ilp-plugin-mock',
      'options': {}
    })
    // have to do this manually as there no client that is actually going to connect to server for now.
    this.accountManager.accountIsConnected.set('test.usd-ledger', true)
    this.accountManager.connectHandlers.get('test.usd-ledger')()
    this.clock = sinon.useFakeTimers(START_DATE)
  })

  afterEach(async function () {
    this.clock.restore()
  })

  describe('new account handler', function () {
    it('should add a new account to accounts', async function () {
      assert.equal(this.accounts.accounts.size, 1)
      await this.accountManager.newAccountHandler('test.eur-ledger-2', {
        relation: 'peer',
        assetCode: 'EUR',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {}
      })
      assert.equal(this.accounts.accounts.size, 2)
    })

    it('should support new ledger', async function () {
      const packetPromise = this.routeBuilder.getNextHopPacket('test.usd-ledger', {
        amount: '100',
        destination: 'test.jpy-ledger.bob',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date('2015-06-16T00:00:02.000Z'),
        data: Buffer.alloc(0)
      })

      await assert.isRejected(packetPromise, UnreachableError, /no route found. source=test.usd-ledger destination=test.jpy.ledger\.bob/)

      await this.accountManager.newAccountHandler('test.jpy-ledger', {
        relation: 'peer',
        assetCode: 'JPY',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {}
      })
      // have to do this manually as there no client that is actually going to connect to server for now.
      this.accountManager.accountIsConnected.set('test.jpy-ledger', true)
      this.accountManager.connectHandlers.get('test.jpy-ledger')()
      assert.equal(this.accounts.accounts.size, 2)

      await this.accountManager.dataHandlers.get('test.jpy-ledger')(serializeCcpRouteUpdateRequest({
        speaker: 'test.jpy-ledger',
        routingTableId: 'b38e6e41-71a0-4088-baed-d2f09caa18ee',
        currentEpochIndex: 0,
        fromEpochIndex: 0,
        toEpochIndex: 1,
        holdDownTime: 45000,
        withdrawnRoutes: [],
        newRoutes: [{
          prefix: 'test.jpy-ledger',
          path: ['test.jpy-ledger'],
          auth: Buffer.from('RLQ3sZWn8Y5TSNJM9qXszfxVlcuERxsxpy+7RhaUadk=', 'base64'),
          props: []
        }]
      }))

      const packetPromise2 = this.routeBuilder.getNextHopPacket('test.usd-ledger', {
        amount: '100',
        destination: 'test.jpy-ledger.bob',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date('2015-06-16T00:00:02.000Z'),
        data: Buffer.alloc(0)
      })

      await assert.isFulfilled(packetPromise2)
    })

    it('should add a peer for the added ledger', async function () {
      await this.accountManager.newAccountHandler('test.eur-ledger-2', {
        relation: 'peer',
        assetCode: 'EUR',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {
          prefix: 'eur-ledger-2'
        }
      })
      // have to do this manually as there no client that is actually going to connect to server for now.
      this.accountManager.accountIsConnected.set('test.eur-ledger-2', true)
      this.accountManager.connectHandlers.get('test.eur-ledger-2')()

      assert.instanceOf(this.routeBroadcaster.peers.get('test.eur-ledger-2'), Peer)
    })
  })

  describe('remove account handler', function () {
    beforeEach(async function () {
      await this.accountManager.newAccountHandler('test.jpy-ledger', {
        relation: 'peer',
        assetCode: 'JPY',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {}
      })
      // have to do this manually as there no client that is actually going to connect to server for now.
      this.accountManager.accountIsConnected.set('test.jpy-ledger', true)
      this.accountManager.connectHandlers.get('test.jpy-ledger')()

      await this.accountManager.dataHandlers.get('test.jpy-ledger')(serializeCcpRouteUpdateRequest({
        speaker: 'test.jpy-ledger',
        routingTableId: 'b38e6e41-71a0-4088-baed-d2f09caa18ee',
        currentEpochIndex: 0,
        fromEpochIndex: 0,
        toEpochIndex: 1,
        holdDownTime: 45000,
        withdrawnRoutes: [],
        newRoutes: [{
          prefix: 'test.jpy-ledger',
          path: ['test.jpy-ledger'],
          auth: Buffer.from('RLQ3sZWn8Y5TSNJM9qXszfxVlcuERxsxpy+7RhaUadk=', 'base64'),
          props: []
        }]
      }))
    })

    it('should remove an account from accounts', async function () {
      assert.isOk(this.accounts.exists('test.jpy-ledger'))
      await this.accountManager.removeAccountHandler('test.jpy-ledger')
      assert.isNotOk(this.accounts.exists('test.jpy-ledger'))
    })

    it('should no longer route to that account', async function () {
      const packetPromise = this.routeBuilder.getNextHopPacket('test.usd-ledger', {
        amount: '100',
        destination: 'test.jpy-ledger.bob',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date('2015-06-16T00:00:02.000Z'),
        data: Buffer.alloc(0)
      })

      await assert.isFulfilled(packetPromise)

      await this.accountManager.removeAccountHandler('test.jpy-ledger')

      const packetPromise2 = this.routeBuilder.getNextHopPacket('test.usd-ledger', {
        amount: '100',
        destination: 'test.jpy-ledger.bob',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date('2015-06-16T00:00:02.000Z'),
        data: Buffer.alloc(0)
      })

      await assert.isRejected(packetPromise2, /no route found. source=test.usd-ledger destination=test.jpy-ledger.bob/)
    })

    it('should depeer the removed ledger', async function () {
      assert.isOk(this.routeBroadcaster.peers.get('test.jpy-ledger'))
      await this.accountManager.removeAccountHandler('test.jpy-ledger')

      assert.isNotOk(this.routeBroadcaster.peers.get('test.jpy-ledger'))
    })
  })
})
