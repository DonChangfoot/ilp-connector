'use strict'

const BigNumber = require("bignumber.js");

const assert = require('assert')
const _ = require('lodash')
const appHelper = require('./helpers/app')
const logger = require('../src/common/log')
const logHelper = require('./helpers/log')
const mockPlugin = require('./mocks/mockPlugin')
const nock = require('nock')
const sinon = require('sinon')
const mock = require('mock-require')
const IlpPacket = require('ilp-packet')

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

const env = _.cloneDeep(process.env)

describe('IlpPrepareController', function () {
  logHelper(logger)

  before(async function () {
    mock('ilp-plugin-mock', mockPlugin)
  })

  beforeEach(async function () {
    const CONNECTOR_ACCOUNTS = {
        'mock.test1': {
            relation: 'peer',
            assetCode: 'USD',
            assetScale: 4,
            plugin: 'ilp-plugin-mock',
            options: {
                type: 'mock',
                host: 'http://test1.mock',
                account: 'xyz',
                username: 'bob',
                password: 'bob'
            }
        },
        'mock.test2': {
            relation: 'peer',
            assetCode: 'EUR',
            assetScale: 4,
            plugin: 'ilp-plugin-mock',
            options: {
                type: 'mock',
                host: 'http://test2.mock',
                account: 'xyz',
                username: 'bob',
                password: 'bob'
            }
        }
    }
    process.env.CONNECTOR_ROUTES = JSON.stringify([{
      targetPrefix: 'mock.test1',
      peerId: 'mock.test1'
    }, {
      targetPrefix: 'mock.test2',
      peerId: 'mock.test2'
    }])

    appHelper.create(this)
    await this.backend.connect()
    const testAccounts = ['mock.test1', 'mock.test2']
    for (let accountId of testAccounts) {
      await this.accountManager.newAccountHandler(accountId, CONNECTOR_ACCOUNTS[accountId])
      //have to do this manually as there no client that is actually going to connect to server for now.
      this.accountManager.accountIsConnected.set(accountId, true)
      this.accountManager.connectHandlers.get(accountId)()
    }

    await this.routeBroadcaster.reloadLocalRoutes()

    this.setTimeout = setTimeout
    this.setInterval = setInterval
    this.clock = sinon.useFakeTimers(START_DATE)
  })

  afterEach(async function () {
    this.clock.restore()
    process.env = _.cloneDeep(env)
  })

  it('should pass on an execution condition fulfillment', async function () {
    const preparePacket = IlpPacket.serializeIlpPrepare({
      amount: '100',
      executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
      expiresAt: new Date(START_DATE + 2000),
      destination: 'mock.test2.bob',
      data: Buffer.alloc(0)
    })
    const fulfillPacket = IlpPacket.serializeIlpFulfill({
      fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
      data: Buffer.alloc(0)
    })

    sinon.stub(this.accountManager, 'sendData')
      .resolves(fulfillPacket)

    const result = await this.accountManager.dataHandlers.get("mock.test1")(preparePacket)

    assert.equal(result.toString('hex'), fulfillPacket.toString('hex'))
  })

  it('should reject when given an invalid fulfillment', async function () {
    const preparePacket = IlpPacket.serializeIlpPrepare({
      amount: '100',
      executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
      expiresAt: new Date(START_DATE + 2000),
      destination: 'mock.test2.bob',
      data: Buffer.alloc(0)
    })
    const fulfillPacket = IlpPacket.serializeIlpFulfill({
      fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
      data: Buffer.alloc(0)
    })

    sinon.stub(this.accountManager, 'sendData')
      .resolves(fulfillPacket)

    const result = await this.accountManager.dataHandlers.get("mock.test1")(preparePacket)

    assert.equal(result[0], IlpPacket.Type.TYPE_ILP_REJECT, 'must be rejected')
    assert.deepEqual(IlpPacket.deserializeIlpReject(result), {
      code: 'F02',
      message: 'fulfillment did not match expected value.',
      triggeredBy: 'test.connie',
      data: Buffer.alloc(0)
    })
  })

  it('applies its rate and reduces the expiry date by one second', async function () {
    const sendSpy = sinon.stub(this.accountManager, 'sendData')
      .resolves(IlpPacket.serializeIlpFulfill({
        fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
        data: Buffer.alloc(0)
      }))


    await this.accountManager.dataHandlers.get("mock.test1")(IlpPacket.serializeIlpPrepare({
      amount: '100',
      executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
      expiresAt: new Date(START_DATE + 2000),
      destination: 'mock.test2.bob',
      data: Buffer.alloc(0)
    }))

    sinon.assert.calledOnce(sendSpy)
    sinon.assert.calledWithMatch(sendSpy, sinon.match(packet => assert.deepEqual(IlpPacket.deserializeIlpPrepare(packet), {
      amount: '94',
      executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
      expiresAt: new Date(START_DATE + 1000),
      destination: 'mock.test2.bob',
      data: Buffer.alloc(0)
    }) || true))
  })

  it('reduces the destination expiry to its max hold time if that time would otherwise be exceeded', async function () {
    const sendSpy = sinon.stub(this.accountManager, 'sendData')
      .resolves(IlpPacket.serializeIlpFulfill({
        fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
        data: Buffer.alloc(0)
      }))


    await this.accountManager.dataHandlers.get("mock.test1")(IlpPacket.serializeIlpPrepare({
      amount: '100',
      executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
      expiresAt: new Date(START_DATE + 200000),
      destination: 'mock.test2.bob',
      data: Buffer.alloc(0)
    }))

    sinon.assert.calledOnce(sendSpy)
    sinon.assert.calledWithMatch(sendSpy, sinon.match(packet => assert.deepEqual(IlpPacket.deserializeIlpPrepare(packet), {
      amount: '94',
      executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
      expiresAt: new Date(START_DATE + 30000),
      destination: 'mock.test2.bob',
      data: Buffer.alloc(0)
    }) || true))
  })

  it.skip('supports optimistic mode', async function () {
    const sendSpy = sinon.stub(this.mockPlugin2Wrapped, 'sendTransfer')
    await this.mockPlugin1.emitAsync('incoming_transfer', {
      id: '5857d460-2a46-4545-8311-1539d99e78e8',
      direction: 'incoming',
      ledger: 'mock.test1',
      amount: '100',
      ilp: IlpPacket.serializeIlpPayment({
        account: 'mock.test2.bob',
        amount: '50'
      })
    })

    sinon.assert.calledOnce(sendSpy)
    sinon.assert.calledWithMatch(sendSpy, {
      direction: 'outgoing',
      ledger: 'mock.test2',
      to: 'mock.test2.bob',
      amount: '50',
      noteToSelf: {
        source_transfer_id: '5857d460-2a46-4545-8311-1539d99e78e8',
        source_transfer_ledger: 'mock.test1',
        source_transfer_amount: '100'
      }
    })
  })

  // TODO What is this functionality used for?
  it.skip('authorizes the payment even if the connector is also the payee of the destination transfer', async function () {
    this.mockPlugin2.FOO = 'bar'
    const sendSpy = sinon.stub(this.mockPlugin2Wrapped, 'sendTransfer')

    await this.mockPlugin1Wrapped.emitAsync('incoming_transfer', {
      amount: '100',
      ilp: IlpPacket.serializeIlpPayment({
        account: 'mock.test2.mark',
        amount: '50'
      })
    })

    sinon.assert.calledOnce(sendSpy)
    sinon.assert.calledWithMatch(sendSpy, {
      direction: 'outgoing',
      ledger: 'mock.test2',
      to: 'mock.test2.mark',
      amount: '50',
      noteToSelf: {
        source_transfer_id: '5857d460-2a46-4545-8311-1539d99e78e8',
        source_transfer_ledger: 'mock.test1',
        source_transfer_amount: '100'
      }
    })
  })

  it.skip('ignores if the connector is the payee of a payment', async function () {
    const rejectSpy = sinon.spy(this.mockPlugin1, 'rejectIncomingTransfer')
    await this.mockPlugin1.emitAsync('incoming_transfer', {
      id: '5857d460-2a46-4545-8311-1539d99e78e8',
      direction: 'incoming',
      ledger: 'mock.test1',
      amount: '100',
      ilp: IlpPacket.serializeIlpPayment({
        account: 'mock.test1.bob',
        amount: '100'
      })
    })
    sinon.assert.notCalled(rejectSpy)
  })

  it('rejects the source transfer if forwarding fails', async function () {
    const preparePacket = IlpPacket.serializeIlpPrepare({
      amount: '100',
      executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
      expiresAt: new Date(START_DATE + 2000),
      destination: 'mock.test2.bob',
      data: Buffer.alloc(0)
    })

    sinon.stub(this.accountManager, 'sendData')
      .rejects(new Error('fail!'))

    const result = await this.accountManager.dataHandlers.get("mock.test1")(preparePacket)

    assert.equal(result[0], IlpPacket.Type.TYPE_ILP_REJECT, 'must be rejected')
    assert.deepEqual(IlpPacket.deserializeIlpReject(result), {
      code: 'F02',
      message: 'failed to send packet: fail!',
      triggeredBy: 'test.connie',
      data: Buffer.alloc(0)
    })
  })

  it('fulfills the source transfer even if settlement fails', async function () {
    const preparePacket = IlpPacket.serializeIlpPrepare({
      amount: '100',
      executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
      expiresAt: new Date(START_DATE + 2000),
      destination: 'mock.test2.bob',
      data: Buffer.alloc(0)
    })
    const fulfillPacket = IlpPacket.serializeIlpFulfill({
      fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
      data: Buffer.alloc(0)
    })

    sinon.stub(this.accountManager, 'sendData')
      .resolves(fulfillPacket)
    sinon.stub(this.accountManager, 'sendMoney')
      .rejects(new Error('fail!'))

    const result = await this.accountManager.dataHandlers.get("mock.test1")(preparePacket)

    assert.equal(result.toString('hex'), fulfillPacket.toString('hex'))
  })

  it.skip('rejects the source transfer if settlement fails with insufficient liquidity', async function () {
    sinon.stub(this.mockPlugin2Wrapped, 'sendTransfer')
      .rejects({
        name: 'InsufficientBalanceError',
        message: 'Sender has insufficient funds.'
      })

    try {
      await this.mockPlugin1Wrapped._transferHandler({
        amount: '100',
        executionCondition: 'I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk',
        expiresAt: (new Date(START_DATE + 2000)).toISOString(),
        ilp: IlpPacket.serializeIlpForwardedPayment({
          account: 'mock.test2.bob'
        }),
        custom: {}
      })
    } catch (err) {
      assert.equal(err.name, 'InterledgerRejectionError')
      assert.deepEqual(IlpPacket.deserializeIlpRejection(err.ilpRejection), {
        code: 'T04',
        triggeredBy: 'test.connie',
        message: 'destination transfer failed: Sender has insufficient funds.',
        data: Buffer.alloc(0)
      })
      return
    }
    assert(false)
  })

  it('rejects with Insufficient Timeout if the incoming transfer is expired', async function () {
    const preparePacket = IlpPacket.serializeIlpPrepare({
      amount: '100',
      executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
      expiresAt: new Date(START_DATE - 1),
      destination: 'mock.test2.bob',
      data: Buffer.alloc(0)
    })

    const result = await this.accountManager.dataHandlers.get('mock.test1')(preparePacket)

    assert.equal(result[0], IlpPacket.Type.TYPE_ILP_REJECT, 'must be rejected')
    assert.deepEqual(IlpPacket.deserializeIlpReject(result), {
      code: 'R02',
      message: 'source transfer has already expired. sourceExpiry=2015-06-15T23:59:59.999Z currentTime=2015-06-16T00:00:00.000Z',
      triggeredBy: 'test.connie',
      data: Buffer.alloc(0)
    })
  })

  it('rejects with Insufficient Timeout if the incoming transfer expires so soon we cannot create a destination transfer with a sufficient large expiry difference', async function () {
    const preparePacket = IlpPacket.serializeIlpPrepare({
      amount: '100',
      executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
      expiresAt: new Date(START_DATE + 1999),
      destination: 'mock.test2.bob',
      data: Buffer.alloc(0)
    })

    const result = await this.accountManager.dataHandlers.get('mock.test1')(preparePacket)

    assert.equal(result[0], IlpPacket.Type.TYPE_ILP_REJECT, 'must be rejected')
    assert.deepEqual(IlpPacket.deserializeIlpReject(result), {
      code: 'R02',
      message: 'source transfer expires too soon to complete payment. actualSourceExpiry=2015-06-16T00:00:01.999Z requiredSourceExpiry=2015-06-16T00:00:02.000Z currentTime=2015-06-16T00:00:00.000Z',
      triggeredBy: 'test.connie',
      data: Buffer.alloc(0)
    })
  })

  describe('when rejected by next hop', function () {
    it('relays the interledger rejection', async function () {
      const rejection = {
        code: '123',
        triggeredBy: 'test.foo',
        message: 'Error 1',
        data: Buffer.alloc(0)
      }
      const rejectStub = sinon.stub(this.accountManager, 'sendData')
        .resolves(IlpPacket.serializeIlpReject(rejection))

      const preparePacket = IlpPacket.serializeIlpPrepare({
        amount: '100',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date(START_DATE + 2000),
        destination: 'mock.test2.bob',
        data: Buffer.alloc(0)
      })

      const result = await this.accountManager.dataHandlers.get('mock.test1')(preparePacket)

      sinon.assert.calledOnce(rejectStub)
      assert.equal(result[0], IlpPacket.Type.TYPE_ILP_REJECT, 'must be rejected')
      assert.deepEqual(IlpPacket.deserializeIlpReject(result), rejection)
    })

    it('does not send funds', async function () {
      const dataStub = sinon.stub(this.accountManager, 'sendData')
        .resolves(IlpPacket.serializeIlpReject({
          code: '123',
          triggeredBy: 'test.foo',
          message: 'Error 1',
          data: Buffer.alloc(0)
        }))
      const moneyStub = sinon.stub(this.accountManager, 'sendMoney')

      const preparePacket = IlpPacket.serializeIlpPrepare({
        amount: '100',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date(START_DATE + 2000),
        destination: 'mock.test2.bob',
        data: Buffer.alloc(0)
      })

      await this.accountManager.dataHandlers.get('mock.test1')(preparePacket)

      sinon.assert.calledOnce(dataStub)
      sinon.assert.notCalled(moneyStub)
    })
  })

  // TODO Re-enable?
  describe.skip('atomic mode', function () {
    beforeEach(function () {
      this.caseId1 = 'http://notary.example/cases/2cd5bcdb-46c9-4243-ac3f-79046a87a086'
      this.caseId2 = 'http://notary.example/cases/2cd5bcdb-46c9-4243-ac3f-79046a87a087'
      this.transfer = {
        id: '5857d460-2a46-4545-8311-1539d99e78e8',
        direction: 'incoming',
        ledger: 'mock.test1',
        amount: '100',
        ilp: IlpPacket.serializeIlpPayment({
          account: 'mock.test2.bob',
          amount: '50'
        })
      }
    })

    // One case

    ;[
      {
        label: 'doesn\'t send when the case\'s expiry is too far in the future',
        case: {expires_at: future(15000)},
        message: 'Destination transfer expiry is too far in the future. The connector\'s money would need to be held for too long'
      }, {
        label: 'doesn\'t send when the case has already expired',
        case: {expires_at: future(-15000)},
        message: 'Transfer has already expired'
      }, {
        label: 'doesn\'t send when the case is missing an expiry',
        case: {},
        message: 'Cases must have an expiry.'
      }
    ].forEach(function (data) {
      it(data.label, async function () {
        const sendSpy = sinon.spy(this.mockPlugin2, 'sendTransfer')
        nock(this.caseId1).get('').reply(200, data.case)
        await this.mockPlugin1.emitAsync('incoming_prepare',
          Object.assign(this.transfer, {cases: [this.caseId1]}))
        assert.equal(sendSpy.called, false)
      })
    })

    // Two cases

    it('doesn\'t send when the cases have different expiries', async function () {
      nock(this.caseId1).get('').reply(200, {expires_at: future(5000)})
      nock(this.caseId2).get('').reply(200, {expires_at: future(6000)})
      const sendSpy = sinon.spy(this.mockPlugin2, 'sendTransfer')
      await this.mockPlugin1.emitAsync('incoming_prepare',
        Object.assign(this.transfer, {cases: [this.caseId1, this.caseId2]}))
      assert.equal(sendSpy.called, false)
    })

    it('authorizes the payment if the case expiries match', async function () {
      nock(this.caseId1).get('').reply(200, {expires_at: future(5000)})
      nock(this.caseId2).get('').reply(200, {expires_at: future(5000)})

      const sendSpy = sinon.spy(this.mockPlugin2, 'sendTransfer')
      await this.mockPlugin1.emitAsync('incoming_prepare',
        Object.assign(this.transfer, {cases: [this.caseId1, this.caseId2]}))

      sinon.assert.calledOnce(sendSpy)
      sinon.assert.calledWithMatch(sendSpy, {
        direction: 'outgoing',
        ledger: 'mock.test2',
        to: 'mock.test2.bob',
        amount: '50',
        cases: [this.caseId1, this.caseId2],
        noteToSelf: {
          source_transfer_id: this.transfer.id,
          source_transfer_ledger: 'mock.test1',
          source_transfer_amount: '100'
        }
      })
    })
  })

  describe('peer protocol', function () {
    beforeEach(async function () {
      this.accounts.add('mock.test3', {
        relation: 'child',
        assetCode: 'USD',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {}
      })
      await this.middlewareManager.addPlugin('mock.test3', this.accountManager)
      this.accountManager.accountIsConnected.set('mock.test3', true)
      await this.accounts.loadIlpAddress()
      this.routeBroadcaster.track('mock.test3')
      this.routeBroadcaster.reloadLocalRoutes()
    })

    it('handles ILDCP requests', async function () {
      const preparePacket = IlpPacket.serializeIlpPrepare({
        amount: '0',
        executionCondition: Buffer.from('Zmh6rfhivXdsj8GLjp+OIAiXFIVu4jOzkCpZHQ1fKSU=', 'base64'),
        expiresAt: new Date(START_DATE + 60000),
        destination: 'peer.config',
        data: Buffer.alloc(0)
      })
      const fulfillPacket = IlpPacket.serializeIlpFulfill({
        fulfillment: Buffer.alloc(32),
        data: Buffer.from('FnRlc3QuY29ubmllLm1vY2sudGVzdDMEA1VTRA==', 'base64')
      })

      const result = await this.accountManager.dataHandlers.get("mock.test3")(preparePacket)
      assert.equal(result.toString('hex'), fulfillPacket.toString('hex'))
    })
  })

  describe('with balance middleware', function () {
    beforeEach(async function () {
      this.accounts.add('mock.test3', {
        relation: 'child',
        assetCode: 'USD',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        balance: {minimum: '-50', maximum: '100'}
      })
      await this.middlewareManager.addPlugin('mock.test3', this.accountManager)
      this.accountManager.accountIsConnected.set('mock.test3', true)
      this.routingTable.insert('mock.test3', {nextHop: 'mock.test3', path: []})
    })

    it('rejects when balance exceeds maximum', async function () {
      const preparePacket = IlpPacket.serializeIlpPrepare({
        amount: '101',
        executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
        expiresAt: new Date(START_DATE + 2000),
        destination: 'mock.test1.bob',
        data: Buffer.alloc(0)
      })

      const result = await this.accountManager.dataHandlers.get("mock.test3")(preparePacket)

      assert.equal(result[0], IlpPacket.Type.TYPE_ILP_REJECT, 'must be rejected')
      assert.deepEqual(IlpPacket.deserializeIlpReject(result), {
        code: 'T04',
        message: 'exceeded maximum balance.',
        triggeredBy: 'test.connie',
        data: Buffer.alloc(0)
      })
    })

    it('fulfills when the incoming balance isn\'t too high', async function () {
      const preparePacket = IlpPacket.serializeIlpPrepare({
        amount: '99',
        executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
        expiresAt: new Date(START_DATE + 2000),
        destination: 'mock.test1.bob',
        data: Buffer.alloc(0)
      })
      const fulfillPacket = IlpPacket.serializeIlpFulfill({
        fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
        data: Buffer.alloc(0)
      })
      sinon.stub(this.accountManager, 'sendData')
        .resolves(fulfillPacket)

      const result = await this.accountManager.dataHandlers.get("mock.test3")(preparePacket)

      assert.equal(result.toString('hex'), fulfillPacket.toString('hex'))
    })

    it.skip('rejects when the payment has insufficient funds', async function () {
      //TODO: can't test for now without importing ilp-plugin-proxy
      const preparePacket = IlpPacket.serializeIlpPrepare({
        amount: '55',
        executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
        expiresAt: new Date(START_DATE + 2000),
        destination: 'mock.test3.bob',
        data: Buffer.alloc(0)
      })
      const fulfillPacket = IlpPacket.serializeIlpFulfill({
        fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
        data: Buffer.alloc(0)
      })

      sinon.stub(this.accountManager, 'sendData')
        .resolves(fulfillPacket)

      const result = await this.accountManager.dataHandlers.get("mock.test1")(preparePacket)

      assert.equal(result[0], IlpPacket.Type.TYPE_ILP_REJECT, 'must be rejected')
      assert.deepEqual(IlpPacket.deserializeIlpReject(result), {
        code: 'F00',
        message: 'insufficient funds. oldBalance=0 proposedBalance=-54',
        triggeredBy: 'test.connie',
        data: Buffer.alloc(0)
      })
    })

    it('fulfills when the outgoing balance isn\'t too low', async function () {
      const preparePacket = IlpPacket.serializeIlpPrepare({
        amount: '49',
        executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
        expiresAt: new Date(START_DATE + 2000),
        destination: 'mock.test3.bob',
        data: Buffer.alloc(0)
      })
      const fulfillPacket = IlpPacket.serializeIlpFulfill({
        fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
        data: Buffer.alloc(0)
      })

      sinon.stub(this.accountManager, 'sendData')
        .resolves(fulfillPacket)

      const result = await this.accountManager.dataHandlers.get("mock.test3")(preparePacket)

      assert.equal(result.toString('hex'), fulfillPacket.toString('hex'))
    })
  })

  describe('with max-packet-amount middleware', function () {
    beforeEach(async function () {
      this.accounts.add('mock.test3', {
        relation: 'child',
        assetCode: 'USD',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        maxPacketAmount: '100'
      })
      this.routingTable.insert('mock.test3', {nextHop: 'mock.test3', path: []})
      await this.middlewareManager.addPlugin("mock.test3", this.accountManager)
      this.accountManager.accountIsConnected.set("mock.test3", true)
    })

    it('rejects when the packet amount is too high', async function () {
      const preparePacket = IlpPacket.serializeIlpPrepare({
        amount: '101',
        executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
        expiresAt: new Date(START_DATE + 2000),
        destination: 'mock.test1.bob',
        data: Buffer.alloc(0)
      })

      const result = await this.accountManager.dataHandlers.get("mock.test3")(preparePacket)

      assert.equal(result[0], IlpPacket.Type.TYPE_ILP_REJECT, 'must be rejected')
      assert.deepEqual(IlpPacket.deserializeIlpReject(result), {
        code: 'F08',
        message: 'packet size too large. maxAmount=100 actualAmount=101',
        triggeredBy: 'test.connie',
        data: Buffer.from([
          0, 0, 0, 0, 0, 0, 0, 101,
          0, 0, 0, 0, 0, 0, 0, 100
        ])
      })
    })
  })

  describe('with rate-limit middleware', function () {
    beforeEach(async function () {
      this.accounts.add('mock.test3', {
        relation: 'child',
        assetCode: 'USD',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        rateLimit: {refillCount: 3, capacity: 3}
      })
      this.routingTable.insert('mock.test3', {nextHop: 'mock.test3', path: []})
      await this.middlewareManager.addPlugin("mock.test3", this.accountManager)
      this.accountManager.accountIsConnected.set("mock.test3", true)
    })

    it('rejects when payments arrive too quickly', async function () {
      const preparePacket = IlpPacket.serializeIlpPrepare({
        amount: '49',
        executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
        expiresAt: new Date(START_DATE + 2000),
        destination: 'mock.test1.bob',
        data: Buffer.alloc(0)
      })
      const fulfillPacket = IlpPacket.serializeIlpFulfill({
        fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
        data: Buffer.alloc(0)
      })

      sinon.stub(this.accountManager, 'sendData')
        .resolves(fulfillPacket)

      for (let i = 0; i < 3; i++) {
        // Empty the token buffer
        await this.accountManager.dataHandlers.get("mock.test3")(preparePacket)
      }
      const result = await this.accountManager.dataHandlers.get("mock.test3")(preparePacket)

      assert.equal(result[0], IlpPacket.Type.TYPE_ILP_REJECT, 'must be rejected')
      assert.deepEqual(IlpPacket.deserializeIlpReject(result), {
        code: 'T05',
        message: 'too many requests, throttling.',
        triggeredBy: 'test.connie',
        data: Buffer.alloc(0)
      })
    })
  })
})

function future (diff) {
  return (new Date(START_DATE + diff)).toISOString()
}
