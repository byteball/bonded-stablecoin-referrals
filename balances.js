/*jslint node: true */
"use strict";
const _ = require('lodash');
const conf = require('ocore/conf.js');
const dag = require('aabot/dag.js');

const assets = require('./assets.js');
const assetPrices = require('./asset_prices.js');

let balancesInAAs = {};

// returns a 2-dimensional assoc array keyed by address and asset
async function getBalancesInMultiAssetAA(aa, prefix) {
	let balances = {};
	const vars = await dag.readAAStateVars(aa, prefix);
	for (let var_name in vars) {
		const balance = vars[var_name];
		const address_asset = var_name.substr(prefix.length);
		const [address, asset] = address_asset.split('_');
		if (!balances[address])
			balances[address] = {};
		balances[address][asset] = balance;
	}
	return balances;
}

// returns a 2-dimensional assoc array keyed by address and asset
async function getBalancesInSingleAssetAA(aa, prefix, asset) {
	let balances = {};
	const vars = await dag.readAAStateVars(aa, prefix);
	for (let var_name in vars) {
		const balance = vars[var_name];
		const address = var_name.substr(prefix.length);
		balances[address] = {};
		balances[address][asset] = balance;
	}
	return balances;
}

function addBalances(dst_balances, src_balances) {
	for (let address in src_balances) {
		if (!dst_balances[address])
			dst_balances[address] = {};
		for (let asset in src_balances[address]) {
			if (!dst_balances[address][asset])
				dst_balances[address][asset] = 0;
			dst_balances[address][asset] += src_balances[address][asset];
		}
	}
}

async function getBalancesInAAs() {
	let balances = {};
	addBalances(balances, await getBalancesInMultiAssetAA(conf.liquidity_mining_aa, 'amount_'));
	addBalances(balances, await getBalancesInMultiAssetAA(conf.bank_aa, 'balance_'));
	addBalances(balances, await getBalancesInMultiAssetAA(conf.odex_aa, 'balance_'));
	for (let aa in assets.governanceAAs) {
		let asset = assets.governanceAAs[aa].asset;
		addBalances(balances, await getBalancesInSingleAssetAA(aa, 'balance_', asset));
	}
	console.log('balancesInAAs', JSON.stringify(balances, null, 2));
	return balances;
}

async function updateBalancesInAAs() {
	balancesInAAs = await getBalancesInAAs();
}

async function getFullBalances(address) {
	if (!balancesInAAs)
		throw Error(`balances in AAs not known yet`);
	const balances = await dag.readBalance(address);
	for (let asset in balances)
		balances[asset] = balances[asset].stable;
	console.log(`own balances of ${address}`, JSON.stringify(balances, null, 2));
	let wallet_balances = _.clone(balances);
	let aa_balances = balancesInAAs[address] || {};
	for (let asset in aa_balances) {
		if (!balances[asset])
			balances[asset] = 0;
		balances[asset] += aa_balances[asset];
	}
	console.log(`full balances of ${address}`, JSON.stringify(balances, null, 2));
	return { balances, wallet_balances, aa_balances };
}

async function getBalance(address) {
	let usd_balance = 0;
	const usd_prices = assetPrices.getUsdPrices();
	const { balances, wallet_balances, aa_balances } = await getFullBalances(address);
	let wallet_balance_details = {};
	let aa_balance_details = {};
	for (let asset in balances) {
		if (!assets.primaryAssets.includes(asset) && !assets.oswapAssets.includes(asset)) {
			console.log(`ignoring balance of ${address} in asset ${asset}`);
			if (wallet_balances[asset])
				wallet_balance_details[asset] = { balance: wallet_balances[asset], eligible: false };
			if (aa_balances[asset])
				aa_balance_details[asset] = { balance: aa_balances[asset], eligible: false };
			continue;
		}
		if (!balances[asset]) {
			console.log(`ignoring 0 balance in asset ${asset}`);
			continue;
		}
		if (!usd_prices[asset])
			throw Error(`USD price of asset ${asset} is not known, address ${address}`);
		usd_balance += balances[asset] * usd_prices[asset];
		if (wallet_balances[asset])
			wallet_balance_details[asset] = {
				balance: wallet_balances[asset],
				usd_balance: wallet_balances[asset] * usd_prices[asset],
				eligible: true
			};
		if (aa_balances[asset])
			aa_balance_details[asset] = {
				balance: aa_balances[asset],
				usd_balance: aa_balances[asset] * usd_prices[asset],
				eligible: true
			};
	}
	return { usd_balance, wallet_balance_details, aa_balance_details };
}

exports.getBalance = getBalance;
exports.updateBalancesInAAs = updateBalancesInAAs;
