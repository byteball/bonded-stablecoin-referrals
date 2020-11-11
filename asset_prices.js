/*jslint node: true */
"use strict";
const conf = require('ocore/conf.js');
const dag = require('aabot/dag.js');
const notifications = require('./notifications.js');
const cryptocompare = require('./cryptocompare.js');
const fetch = require('node-fetch');

const assets = require('./assets.js');

let gb_prices = {};
let usd_prices = {};

function getUsdPrices() {
	if (Object.keys(usd_prices).length === 0)
		throw Error("no USD prices yet");
	return usd_prices;
}

async function updatePrices() {
	// stablecoin tokens (T1, T2, stable)
	try {
		var trading_data = await (await fetch(conf.assets_data_url)).json();
		console.log(`got trading data`, JSON.stringify(trading_data, null, 2));
	}
	catch (e) {
		console.log("error when fetching " + e.message);
		notifications.notifyAdmin("error when fetching " + conf.assets_data_url, e.message);
		return false;
	}
	for (let symbol in trading_data) {
		const asset = trading_data[symbol].asset_id;
		gb_prices[asset] = trading_data[symbol].last_gbyte_value / (10 ** trading_data[symbol].decimals);
	}
	const getAssetGbPrice = (asset) => {
		if (asset in gb_prices)
			return gb_prices[asset];
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
			const total_value = balances[reserve_asset] * getAssetGbPrice(reserve_asset) + balances[asset1] * getAssetGbPrice(asset1);
		
			const shares_supply = await dag.readAAStateVar(aa, "shares_supply");
			if (!shares_supply) {
				if (balances[reserve_asset] && !balances[asset1] && reserve_asset === 'base') {
					console.log(`shares not issued yet in t1 arb ${aa}`);
					continue;
				}
				throw Error(`no shares supply of t1 arb ${aa}`);
			}

			gb_prices[shares_asset] = total_value / shares_supply;
		}
		else
			gb_prices[shares_asset] = 0;
	}

	// interest/stable arbs
	for (let aa in assets.interestArbs) {
		const interest_asset = assets.interestArbs[aa].interest_asset;
		const shares_asset = assets.interestArbs[aa].shares_asset;

		const balances = await dag.readAABalances(aa);
		if (balances[interest_asset] !== undefined) {
		
			const balance_in_challenging_period = (await dag.readAAStateVar(aa, "balance_in_challenging_period")) || 0;
			const total_value = (balances[interest_asset] + balance_in_challenging_period) * getAssetGbPrice(interest_asset);

			const shares_supply = await dag.readAAStateVar(aa, "shares_supply");
			if (!shares_supply)
				throw Error(`no shares supply of interest arb ${aa}`);
		
			gb_prices[shares_asset] = total_value / shares_supply;
		}
		else
			gb_prices[shares_asset] = 0;
	}

	// oswap pool assets
	for (let aa in assets.oswapPools) {
		const asset0 = assets.oswapPools[aa].asset0;
		const asset1 = assets.oswapPools[aa].asset1;
		const pool_asset = assets.oswapPools[aa].asset;

		const balances = await dag.readAABalances(aa);
		if (!balances[asset0] || !balances[asset1]) {
			console.log(`pool ${aa} with 0 balances`);
			continue;
		}
		
		const total_pool_value = balances[asset0] * getAssetGbPrice(asset0) + balances[asset1] * getAssetGbPrice(asset1);
		if (!total_pool_value)
			throw Error(`total_pool_value of pool ${aa}: ${total_pool_value}`);
		
		const pool_asset_supply = await dag.readAAStateVar(aa, "supply");
		if (!pool_asset_supply)
			throw Error(`no supply for pool asset ${pool_asset}`);
		
		gb_prices[pool_asset] = total_pool_value / pool_asset_supply;
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
	for (let asset in gb_prices)
		usd_prices[asset] = gb_prices[asset] * gb_rate;
	
	return true;
}

exports.updatePrices = updatePrices;
exports.getUsdPrices = getUsdPrices;
