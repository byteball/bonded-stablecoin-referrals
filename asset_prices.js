/*jslint node: true */
"use strict";
const conf = require('ocore/conf.js');
const dag = require('aabot/dag.js');
const notifications = require('./notifications.js');
const cryptocompare = require('./cryptocompare.js');
const fetch = require('node-fetch');
const AbortController = require('abort-controller');

const assets = require('./assets.js');

let usdSmallestUnitPrices = {};
let usdDisplayPrices = {};
let gbSmallestUnitPrices = {};
let gbDisplayPrices = {};
let unitMultipliers = {};

function getUsdPrices() {
	if (Object.keys(usdSmallestUnitPrices).length === 0)
		throw Error("no USD prices yet");
	return usdSmallestUnitPrices;
}

function getUsdDisplayPrices() {
	if (Object.keys(usdDisplayPrices).length === 0)
		throw Error("no USD prices yet");
	return usdDisplayPrices;
}

async function updatePrices() {
	// stablecoin tokens (T1, T2, stable)
	const controller = new AbortController();
	const timeout = setTimeout(() => {
		controller.abort();
	}, 60 * 1000);
	try {
		var trading_data = await (await fetch(conf.assets_data_url, { signal: controller.signal })).json();
		console.log(`got trading data`, JSON.stringify(trading_data, null, 2));
	}
	catch (e) {
		console.log("error when fetching " + e.message);
		notifications.notifyAdmin("referrals: error when fetching " + conf.assets_data_url, e.message);
		return false;
	}
	finally {
		clearTimeout(timeout);
	}
	for (let symbol in trading_data) {
		const asset = trading_data[symbol].asset_id;
		unitMultipliers[asset] = 10 ** (trading_data[symbol].decimals || 0);
		if (typeof trading_data[symbol].last_gbyte_value === 'number') {
			gbSmallestUnitPrices[asset] = trading_data[symbol].last_gbyte_value / (unitMultipliers[asset] || 1);
			gbDisplayPrices[asset] = trading_data[symbol].last_gbyte_value;
		}
	}
	const getAssetPrice = (asset) => {
		if (asset in gbSmallestUnitPrices)
			return gbSmallestUnitPrices[asset];
		throw Error(`no trading data for asset ${asset}`);
	}

	// T1 arbs
	for (let aa in assets.t1Arbs) {
		const reserve_asset = assets.t1Arbs[aa].reserve_asset;
		const asset1 = assets.t1Arbs[aa].asset1;
		const shares_asset = assets.t1Arbs[aa].shares_asset;

		const balances = await dag.readAABalances(aa);
		if (!balances[reserve_asset])
			balances[reserve_asset] = 0;
		if (!balances[asset1])
			balances[asset1] = 0;
		
		if (balances[reserve_asset] || balances[asset1]) {
			const total_value = balances[reserve_asset] * getAssetPrice(reserve_asset) + balances[asset1] * getAssetPrice(asset1);
		
			const shares_supply = await dag.readAAStateVar(aa, "shares_supply");
			if (!shares_supply) {
				if (balances[reserve_asset] && !balances[asset1] && reserve_asset === 'base') {
					console.log(`shares not issued yet in t1 arb ${aa}`);
					continue;
				}
				throw Error(`no shares supply of t1 arb ${aa}`);
			}
			gbSmallestUnitPrices[shares_asset] = total_value / shares_supply;
			if (unitMultipliers[reserve_asset])
				gbDisplayPrices[shares_asset] = gbSmallestUnitPrices[shares_asset] * unitMultipliers[reserve_asset];
		}
		else
			gbDisplayPrices[shares_asset] = gbSmallestUnitPrices[shares_asset] = 0;
	}

	// interest/stable arbs
	for (let aa in assets.interestArbs) {
		const interest_asset = assets.interestArbs[aa].interest_asset;
		const shares_asset = assets.interestArbs[aa].shares_asset;

		const balances = await dag.readAABalances(aa);
		if (balances[interest_asset] !== undefined) {
		
			const balance_in_challenging_period = (await dag.readAAStateVar(aa, "balance_in_challenging_period")) || 0;
			const total_value = (balances[interest_asset] + balance_in_challenging_period) * getAssetPrice(interest_asset);

			const shares_supply = await dag.readAAStateVar(aa, "shares_supply");
			if (!shares_supply) {
				if (total_value === 0) {
					console.log(`no shares and no assets in interest arb ${aa}`);
					continue;
				}
				throw Error(`no shares supply of interest arb ${aa}`);
			}

			gbSmallestUnitPrices[shares_asset] = total_value / shares_supply;
			console.log(`interest arb ${aa} shares asset ${shares_asset} price ${gbSmallestUnitPrices[shares_asset]}`);
			if (unitMultipliers[interest_asset])
				gbDisplayPrices[shares_asset] = gbSmallestUnitPrices[shares_asset] * unitMultipliers[interest_asset];
		}
		else
			gbDisplayPrices[shares_asset] = gbSmallestUnitPrices[shares_asset] = 0;
	}

	// oswap pool assets
	for (let aa in assets.oswapPools) {
		const asset0 = assets.oswapPools[aa].asset0;
		const asset1 = assets.oswapPools[aa].asset1;
		const shares_asset = assets.oswapPools[aa].asset;

		const balances = await dag.readAABalances(aa);
		if (!balances[asset0] || !balances[asset1]) {
			console.log(`pool ${aa} with 0 balances`);
			continue;
		}
		
		let total_value = 0;
		try {
			total_value = balances[asset0] * getAssetPrice(asset0) + balances[asset1] * getAssetPrice(asset1);
		}
		catch (err) {
			console.log(err);
			continue;
		}

		if (!total_value)
			throw Error(`total_value of pool ${aa}: ${total_value}`);
		
		const shares_supply = await dag.readAAStateVar(aa, "supply");
		if (!shares_supply)
			throw Error(`no supply for pool share asset ${shares_asset}`);
		
		gbDisplayPrices[shares_asset] = gbSmallestUnitPrices[shares_asset] = total_value / shares_supply;
	}

	// convert to USD
	try {
		var gb_rate = await cryptocompare.fetchExchangeRate();
	}
	catch (e) {
		console.log("error from cryptocompare " + e.message);
		notifications.notifyAdmin("error from cryptocompare", e.message);
		return false;
	}
	for (let asset in gbSmallestUnitPrices)
		usdSmallestUnitPrices[asset] = gbSmallestUnitPrices[asset] * gb_rate;
	for (let asset in gbDisplayPrices)
		usdDisplayPrices[asset] = gbDisplayPrices[asset] * gb_rate;
	
	return true;
}

exports.updatePrices = updatePrices;
exports.getUsdPrices = getUsdPrices;
exports.getUsdDisplayPrices = getUsdDisplayPrices;
