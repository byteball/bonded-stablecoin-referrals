/*jslint node: true */
"use strict";

const Koa = require('koa');
const KoaRouter = require('koa-router');
const cors = require('@koa/cors');
const bodyParser = require('koa-bodyparser');

const ValidationUtils = require('ocore/validation_utils.js');
const conf = require('ocore/conf.js');
const db = require('ocore/db.js');

const app = new Koa();
const router = new KoaRouter();

app.use(bodyParser());


function setError(ctx, error) {
	ctx.body = {
		status: 'error',
		error: error.toString(),
	};
	console.error('ERROR:', error);
}

router.get('/referrals/:address', async (ctx) => {
	console.error('referrals', ctx.params);
	const address = ctx.params.address;
	if (!ValidationUtils.isValidAddress(address))
		return setError(ctx, "invalid user address");
	const [{ distribution_id, snapshot_time, distribution_date }] = await db.query(`SELECT distribution_id, snapshot_time, distribution_date FROM distributions ORDER BY distribution_id DESC LIMIT 1`);
	let [my_info] = await db.query(
		`SELECT users.address, referrer_address, usd_balance, reward_in_smallest_units, usd_reward, share
		FROM users 
		LEFT JOIN rewards ON users.address=rewards.address AND rewards.distribution_id=? 
		LEFT JOIN balances ON users.address=balances.address AND balances.distribution_id=? 
		WHERE users.address=?`,
		[distribution_id, distribution_id, address]
	);
	if (!my_info) {
		const [my_reward_info] = await db.query(
			`SELECT address, reward_in_smallest_units, usd_reward, share
			FROM rewards
			WHERE address=? AND distribution_id=?`,
			[address, distribution_id]
		);
		my_info = my_reward_info;
	}
	const referrals = await db.query(
		`SELECT users.address, usd_balance, reward_in_smallest_units, usd_reward, share
		FROM users 
		LEFT JOIN rewards ON users.address=rewards.address AND rewards.distribution_id=? 
		LEFT JOIN balances ON users.address=balances.address AND balances.distribution_id=? 
		WHERE referrer_address=?
		ORDER BY usd_balance DESC`,
		[distribution_id, distribution_id, address]
	);
	ctx.body = {
		status: 'success',
		data: {
			last_updated: snapshot_time,
			distribution_id,
			distribution_date,
			my_info,
			referrals,
		}
	};
});

router.get('/distributions/:distribution_id', async (ctx) => {
	console.error('distributions', ctx.params);
	const id = ctx.params.distribution_id;
	if (id !== 'next' && !id.match(/^\d+$/))
		return setError(ctx, `invalid distribution_id: ${id}`);
	
	const [{ distribution_id, snapshot_time, distribution_date }] = await db.query(`SELECT distribution_id, snapshot_time, distribution_date FROM distributions ${id === 'next' ? 'ORDER BY distribution_id DESC LIMIT 1' : 'WHERE distribution_id=' + db.escape(id)}`);
	if (!distribution_id)
		return setError(ctx, `no such distribution_id: ${id}`);
	
	const balances = await db.query(`SELECT address, usd_balance FROM balances WHERE distribution_id=? ORDER BY usd_balance DESC`, [distribution_id]);
	const rewards = await db.query(`SELECT address, reward_in_smallest_units, usd_reward, share FROM rewards WHERE distribution_id=? ORDER BY usd_reward DESC`, [distribution_id]);
	ctx.body = {
		status: 'success',
		data: {
			last_updated: snapshot_time,
			distribution_id,
			distribution_date,
			balances,
			rewards,
		}
	};
});

router.get('/users', async (ctx) => {
	console.error('users', ctx.params);
	const users = await db.query(`SELECT address, referrer_address, first_unit FROM users`);
	ctx.body = {
		status: 'success',
		data: {
			users,
		}
	};
});

app.use(cors());
app.use(router.routes());

function start() {
	app.listen(conf.webPort);
}

exports.start = start;
