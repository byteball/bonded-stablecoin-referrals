/*jslint node: true */
'use strict';
const conf = require('ocore/conf');
const db = require('ocore/db');
const network = require('ocore/network');
const eventBus = require('ocore/event_bus');
const validationUtils = require('ocore/validation_utils');
const dag = require('aabot/dag');
const { argv } = require('yargs');

let aas = [];

async function onAAResponse(objAAResponse) {
	console.log(`onAAResponse`, objAAResponse);
	if (objAAResponse.bounced)
		return console.log('bounced trigger');
	const aa_address = objAAResponse.aa_address;
	const trigger_address = objAAResponse.trigger_address;
	const objJoint = await dag.readJoint(objAAResponse.trigger_unit);
	if (!objJoint)
		throw Error("no trigger unit? " + objAAResponse.trigger_unit);
	const dataMessage = objJoint.unit.messages.find(m => m.app === 'data');
	if (!dataMessage)
		return console.log(`no data message in trigger ` + objAAResponse.trigger_unit);
	let ref = dataMessage.payload.ref || null;
	if (ref && !validationUtils.isValidAddress(ref)) {
		console.log(`ref ${ref} is not a valid address in trigger ` + objAAResponse.trigger_unit);
		ref = null;
	}
	if (ref === trigger_address) {
		console.log(`attempt to self-refer by ${ref} in trigger ` + objAAResponse.trigger_unit);
		ref = null;		
	}
	const rows = await db.query("SELECT 1 FROM aa_addresses WHERE address=?", [ref]);
	if (rows.length > 0) {
		console.log(`attempt to set an AA as referrer ${ref} in trigger ` + objAAResponse.trigger_unit);
		ref = null;
	}
	let user_address = trigger_address;

	// check if the request comes from buffer AA
	const sender_definition = await dag.readAADefinition(trigger_address);
	if (sender_definition && sender_definition[1].base_aa === conf.buffer_base_aa) {
		user_address = sender_definition[1].params.address;
		if (!validationUtils.isValidAddress(user_address))
			throw Error(`bad address in buffer AA ${trigger_address}`);
		if (ref === user_address) {
			console.log(`attempt to self-refer through buffer ${trigger_address} by ${ref} in trigger ` + objAAResponse.trigger_unit);
			ref = null;		
		}
	}
	
	await db.query(`INSERT ${db.getIgnore()} INTO users (address, referrer_address, first_unit) VALUES (?, ?, ?)`, [user_address, ref, objAAResponse.trigger_unit]);
}

async function rescan() {
	console.log('=== will rescan');
	const rows = await db.query(`SELECT trigger_address, aa_address, trigger_unit FROM aa_responses WHERE aa_address IN(?) AND bounced=0 ORDER BY aa_response_id`, [aas]);
	for (let row of rows)
		await onAAResponse(row);
	console.log('=== done rescanning');
}

function addCurveAA(aa) {
	console.log(`will watch for responses from curve AA ${aa}`);
	aas.push(aa);
	eventBus.on('aa_response_from_aa-' + aa, onAAResponse);
	if (conf.bLight)
		network.addLightWatchedAa(aa, null, err => {
			if (err)
				throw Error(err);
		});
}


async function start() {
	if (argv.rescan)
		await rescan();
	if (conf.bLight) {
		eventBus.on("message_for_light", (ws, subject, body) => {
			switch (subject) {
				case 'light/aa_response':
					onAAResponse(body);
					break;
			}
		});
	}
}


exports.addCurveAA = addCurveAA;
exports.start = start;
