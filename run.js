/*jslint node: true */
"use strict";
const eventBus = require('ocore/event_bus.js');
const network = require('ocore/network.js');
const conf = require('ocore/conf.js');

const db_import = require('./db_import.js');
const assets = require('./assets.js');
const referrals = require('./referrals.js');
const assetPrices = require('./asset_prices.js');
const webserver = require('./webserver.js');
const distribution = require('./distribution.js');


eventBus.on('headless_wallet_ready', async () => {
	await db_import.initDB();
	network.start();
	await assets.start();
	await referrals.start();
	await assetPrices.updatePrices();
	setInterval(assetPrices.updatePrices, 20 * 60 * 1000);
	webserver.start();
	await distribution.start();
});

process.on('unhandledRejection', up => { throw up; });
