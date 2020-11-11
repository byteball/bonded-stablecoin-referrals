/*jslint node: true */
"use strict";
const CronJob = require('cron').CronJob;

const eventBus = require('ocore/event_bus');
const constants = require('ocore/constants.js');
const conf = require('ocore/conf.js');
const desktopApp = require('ocore/desktop_app.js');
const db = require('ocore/db.js');
const mutex = require('ocore/mutex.js');
const headlessWallet = require('headless-obyte');
const operator = require('aabot/operator.js');
const dag = require('aabot/dag.js');

const notifications = require('./notifications.js');
const assetPrices = require('./asset_prices.js');
const balances = require('./balances.js');

let bPaymentFailedNotified = false;

async function getCurrentDistributionId() {
	const rows = await db.query("SELECT distribution_id, is_frozen FROM distributions WHERE is_completed=0");
	if (rows.length > 1)
		throw Error("more than one current distribution");
	const row = rows[0];
	if (row && row.is_frozen)
		return null;
	if (row)
		return row.distribution_id;
	// create a new one
	let res = await db.query(`INSERT INTO distributions (distribution_date) VALUES (
		(SELECT DATETIME(distribution_date, '+${conf.daysBetweenDistributions} DAYS') 
		FROM distributions 
		ORDER BY distribution_id DESC LIMIT 1)
	)`);
	return res.insertId;
}

async function getSuspendedReferrers(conn) {
	conn = conn || db;
	const rows = await conn.query("SELECT address FROM suspended_referrers");
	return rows.map(row => row.address);
}

async function updateRewards() {
	console.log('updateRewards');
	const unlock = await mutex.lock(['updateRewards']);
	const finish = (err) => {
		console.log(err);
		unlock();
	};
	let distribution_id = await getCurrentDistributionId();
	if (!distribution_id)
		return finish("distributing now");

	if (!await assetPrices.updatePrices())
		return finish("failed to update prices");
	
	const growth_factor = await dag.executeGetter(conf.iusd_curve_aa, 'get_growth_factor');

	await balances.updateBalancesInAAs();

	const suspended_referrers = await getSuspendedReferrers();
	let unscaled_rewards = {};
	let total_unscaled_rewards = 0;
	let total_balance = 0; // including unreferred users
	let balancesByAddress = {};
	const rows = await db.query("SELECT address, referrer_address FROM users");
	for (let { address } of rows)
		balancesByAddress[address] = await balances.getBalance(address);
	
	const conn = await db.takeConnectionFromPool();
	await conn.query("BEGIN");
	await conn.query("DELETE FROM balances WHERE distribution_id=?", [distribution_id]);
	await conn.query("DELETE FROM rewards WHERE distribution_id=?", [distribution_id]);

	for (let { address, referrer_address } of rows) {
		let { usd_balance, wallet_balance_details, aa_balance_details } = balancesByAddress[address];
		total_balance += usd_balance;
		await conn.query("INSERT INTO balances (distribution_id, address, usd_balance, details) VALUES (?, ?, ?, ?)", [distribution_id, address, usd_balance, JSON.stringify({ wallet_balance_details, aa_balance_details })]);
		if (!referrer_address || suspended_referrers.includes(referrer_address))
			continue;
		if (!unscaled_rewards[address])
			unscaled_rewards[address] = 0;
		if (!unscaled_rewards[referrer_address])
			unscaled_rewards[referrer_address] = 0;
		const referral_reward = conf.referredReward * usd_balance;
		const referrer_reward = conf.referrerReward * usd_balance;
		unscaled_rewards[address] += referral_reward;
		unscaled_rewards[referrer_address] += referrer_reward;
		total_unscaled_rewards += referral_reward + referrer_reward;
	}
	if (total_unscaled_rewards === 0) {
		await conn.query("UPDATE distributions SET total_usd_balance=?, total_unscaled_rewards=0, total_rewards=0, snapshot_time=datetime('now') WHERE distribution_id=?", [total_balance, distribution_id]);
		await conn.query("COMMIT");
		conn.release();
		return finish("no rewards");
	}

	let rewards = {};
	let total_rewards;
	if (total_unscaled_rewards <= conf.max_total_reward) {
		total_rewards = total_unscaled_rewards;
		rewards = unscaled_rewards;
	}
	else { // scale down
		total_rewards = conf.max_total_reward;
		for (let address in unscaled_rewards)
			rewards[address] = unscaled_rewards[address] * total_rewards / total_unscaled_rewards;
	}
	for (let address in rewards) {
		let usd_reward = rewards[address];
		let share = usd_reward / total_rewards;
		let reward_in_smallest_units = Math.floor(usd_reward / growth_factor * 1e4); // in smallest units of IUSD
		await conn.query("INSERT INTO rewards (distribution_id, address, usd_reward, share, reward_in_smallest_units) VALUES(?,?, ?,?,?)", [distribution_id, address, usd_reward, share, reward_in_smallest_units]);
	}
	await conn.query("UPDATE distributions SET total_usd_balance=?, total_unscaled_rewards=?, total_rewards=?, snapshot_time=datetime('now') WHERE distribution_id=?", [total_balance, total_unscaled_rewards, total_rewards, distribution_id]);
	await conn.query("UPDATE distributions SET is_frozen=1 WHERE is_frozen=0 AND distribution_date <= datetime('now')");
	await conn.query("COMMIT");
	conn.release();
	unlock();
}


async function distributeIfReady() {
	console.log('distributeIfReady');
	const unlock = await mutex.lock(['distribute']);
	const finish = (err) => {
		console.log(err);
		unlock();
	};

	const rows = await db.query("SELECT snapshot_time, distribution_id, total_rewards, bought_reward_asset FROM distributions WHERE is_frozen=1 AND is_completed=0");

	if (rows.length > 1)
		throw Error("More than 1 distribution to be made?");
	if (!rows[0])
		return finish("no distribution ready")
	const { distribution_id, snapshot_time, total_rewards, bought_reward_asset } = rows[0];
	if (!bought_reward_asset) {
		console.log("reward asset not bought yet");
		if (!await buyRewardAsset(total_rewards))
			return finish("still buying the reward asset");
		await db.query("UPDATE distributions SET bought_reward_asset=1 WHERE distribution_id=?", [distribution_id]);		
	}
	const arrOutputs = await createDistributionOutputs(distribution_id, snapshot_time); // max 127 outputs

	if (arrOutputs.length === 0) { // done
		await db.query("UPDATE distributions SET is_completed=1 WHERE distribution_id=?", [distribution_id]);
		return finish("finished distribution")
	}
	var opts = {
		asset: conf.iusd_asset,
		asset_outputs: arrOutputs,
		change_address: operator.getAddress(),
		spend_unconfirmed: 'all',
	};

	headlessWallet.sendMultiPayment(opts, async function(err, unit) {
		if (err) {
			console.log("payment failed " + err);
			if (!bPaymentFailedNotified){
				notifications.notifyAdmin("a payment failed", err);
				bPaymentFailedNotified = true;
			}
			setTimeout(distributeIfReady, 300 * 1000);
			return unlock();
		}
		bPaymentFailedNotified = false;
		await db.query("UPDATE rewards SET payment_unit=? WHERE address IN (?) AND distribution_id=?", 
		[unit, arrOutputs.map(o => o.address), distribution_id]);
		unlock();
		distributeIfReady(); // next set of 127 outputs
	});
}


async function createDistributionOutputs(distribution_id, distributionSnapshotDate) {
	return await db.query(
		`SELECT rewards.reward_in_smallest_units AS amount, rewards.address
		FROM rewards
		LEFT JOIN outputs
			ON rewards.address=outputs.address
			AND asset=?
			AND (SELECT address FROM unit_authors WHERE unit_authors.unit=outputs.unit)=?
			AND (SELECT creation_date FROM units WHERE units.unit=outputs.unit)>?
			AND rewards.reward_in_smallest_units=outputs.amount
		WHERE outputs.address IS NULL
			AND distribution_id=? 
			AND payment_unit IS NULL
			AND rewards.reward_in_smallest_units > 0
		ORDER BY rewards.reward_in_smallest_units
		LIMIT ?`,
		[conf.iusd_asset, operator.getAddress(), distributionSnapshotDate, distribution_id, constants.MAX_OUTPUTS_PER_PAYMENT_MESSAGE - 1]
	);
}

async function buyRewardAsset(total_rewards) {
	console.log('buyRewardAsset');
	const total_rewards_in_smallest_inits = Math.floor(total_rewards * 1e4);
	const balances = await dag.readBalance(operator.getAddress());
	const iusd_balance = balances[conf.iusd_asset] ? balances[conf.iusd_asset].total/1e4 : 0;
	if (Math.round(iusd_balance * 1e4) >= total_rewards_in_smallest_inits) {
		console.log(`have enough IUSD`);
		return true;
	}
	console.log(`have only ${iusd_balance} IUSD, need ${total_rewards}, will buy`);
	const rows = await db.query(
		`SELECT unit
		FROM units JOIN outputs USING(unit) JOIN unit_authors USING(unit) 
		WHERE unit_authors.address=? AND outputs.address=? AND asset IS NULL AND is_stable=0`,
		[operator.getAddress(), conf.iusd_curve_aa]
	);
	if (rows.length > 0) {
		console.log(`already buying IUSD in unit ${rows[0].unit}`);
		return false;
	}
	const res = await dag.executeGetter(conf.iusd_curve_aa, 'get_exchange_result', [0, total_rewards_in_smallest_inits]);
	console.log('expected result', res);
	if (res.fee_percent > conf.max_fee) {
		console.log(`fee would be ${res.fee_percent}%`);
		return false;
	}
	// add 1% for volatility
	const amount = Math.ceil(res.reserve_needed * 1.01);
	const unit = await dag.sendPayment({
		to_address: conf.iusd_curve_aa,
		amount,
		data: { tokens2: total_rewards_in_smallest_inits },
	});
	if (!unit) {
		console.log(`failed to send bytes to curve AA`);
		return false;
	}
	eventBus.once('aa_response_to_unit-' + unit, objAAResponse => {
		console.log(`got response to our IUSD purchase`);
		if (objAAResponse.bounced)
			return console.log(`trigger ${unit} bounced: ${objAAResponse.response.error}`);
		distributeIfReady();
	});
	return false;
}

async function loop() {
	await updateRewards();
	await distributeIfReady();
}

async function start() {
	if (!conf.admin_email || !conf.from_email) {
		console.log("please specify admin_email and from_email in your " + desktopApp.getAppDataDir() + "/conf.json");
		process.exit(1);
	}

	if (!conf.bSingleAddress) {
		console.log("config must be single address wallet");
		process.exit(1);
	}
	await operator.start();
	await loop();
	const job = new CronJob('0 */5 * * * *', loop);
	job.start();
}

exports.start = start;
