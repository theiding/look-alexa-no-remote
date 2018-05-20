'use strict';
var Alexa = require('alexa-sdk');
var Http = require('http');
var Config = require('./config');

exports.handler = function(event, context, callback) {
    var alexa = Alexa.handler(event, context);
    alexa.registerHandlers(	
		generalHandlers, 
		remoteButtonHandlers
	);
    alexa.execute();
};

const states = {
	PRESS_REMOTE_BUTTON_MODE: '_pressRemoteButtonMODE'	
};

// Alexa prompt/response strings
const ALEXA_HELP = "I can be your remote control for your tv and attached devices so you don't have to use your physical remotes. To start just say the name of a button you want me to press. For example you can say Menu, Left or Select. To switch to a different device use the Switch to command. For example say Switch to Apple TV. Which button would you like me to press?";
const ALEXA_REQUEST_BUTTON = "Please say a button that you would like me to press.";
const ALEXA_OK = "Ok";
const ALEXA_GENERAL_ERROR = "Sorry, something went wrong.";
const ALEXA_EMPTY_REPROMPT = "";	// Note that we are re-prompting after a successful command with an empty string. 
									// That effectively gives the user twice the time to say the next key without getting interrupted by a reprompt. 
									// What we really would like is of course for Amazon to allow us to configure the time until reprompt. 

var generalHandlers = {
	'AMAZON.StopIntent': abort,
	'AMAZON.CancelIntent': abort,
    'AMAZON.HelpIntent': function() {
		var cmdPromise = startSession(this);
		emit(this, ALEXA_HELP, ALEXA_REQUEST_BUTTON, cmdPromise);
    },
    'Unhandled': function() {	// We wan't our session to be started with the shortest possible voice command - and that is just the skill name (i.e. "Alexa, remote control").
								// Since "Alexa, remote control" doesn't invoke any intent it triggers the 'Unhandled' handler. We use this to start our session.
		var cmdPromise = startSession(this);
		emit(this, "Ok. Ready.", ALEXA_REQUEST_BUTTON, cmdPromise);
	}
};

var remoteButtonHandlers = Alexa.CreateStateHandler(states.PRESS_REMOTE_BUTTON_MODE, {
    'PressRemoteButtonIntent': function() {
		var buttonCmds = [];
		buttonCmds.push({'remoteButtonSlot': this.event.request.intent.slots.RemoteButton, 'pressCountSlot': this.event.request.intent.slots.PressCount});
		pressRemoteButtons(this, buttonCmds);
	},
    'PressTwoRemoteButtonsIntent': function() {
		var buttonCmds = [];
		buttonCmds.push({'remoteButtonSlot': this.event.request.intent.slots.RemoteButtonOne, 'pressCountSlot': this.event.request.intent.slots.PressCountOne});
		buttonCmds.push({'remoteButtonSlot': this.event.request.intent.slots.RemoteButtonTwo, 'pressCountSlot': this.event.request.intent.slots.PressCountTwo});
		pressRemoteButtons(this, buttonCmds);
	},
	'SwitchTVSourceIntent': function() {
		switchTVSource(this, this.event.request.intent.slots.TVSource);
	},
	'AMAZON.StopIntent': abort,
	'AMAZON.CancelIntent': abort,
	'AMAZON.HelpIntent': function() {
		emit(this, ALEXA_HELP, ALEXA_REQUEST_BUTTON);
	},
	'SessionEndedRequest': function() {
		console.log('SessionEndedRequest received');
		endSession();
	},
 	'Unhandled': function() {
		emit(this, "Sorry, I didn't understand that. Please try again.", ALEXA_REQUEST_BUTTON);
	}
});

function startSession(alexa) {
	console.log("startSession");
	
	alexa.handler.state = states.PRESS_REMOTE_BUTTON_MODE;
	alexa.attributes['TVSOURCE'] = Config.skill.defaultDevice; // We start out by sending button presses to the default device
	alexa.attributes['WINDING'] = false; // We are not winding until user presses fast forward or rewind
	return sendCmd({'item': Config.skill.tv, 'cmd': Config.skill.tvMute}); // Mute the tv so it won't interfere with subsequent voice commands
}

function endSession() {
	console.log("endSession");

	return sendCmd({'item': Config.skill.tv, 'cmd': Config.skill.tvUnmute}); // Unmute the tv when we are done
}

// Press multiple buttons as defined by the buttonCmds array.
// Each buttonCmd must provide property remoteButtonSlot to specify the button as well as property pressCountSlot for repeated button presses. 
function pressRemoteButtons(alexa, buttonCmds) {
	var responseStr = null;
	var repeatStr = null;
	var cmdPromise = null;
	var result = {'cmdPromise': null, 'done': false};
	
	console.log("pressRemoteButtons");
	
	try {
		for(var i = 0; i < buttonCmds.length; i++) {
			if (!result.done)
				result = pressRemoteButton(alexa, buttonCmds[i].remoteButtonSlot, buttonCmds[i].pressCountSlot, result.cmdPromise);

			responseStr = result.done ? "Ok. Done." : ALEXA_OK;
			repeatStr = result.done ? null : ALEXA_EMPTY_REPROMPT;
		}
	}
	catch (err) {
		console.log("pressRemoteButtons err=");
		console.log(err); // Need to log err separately to properly log both Strings and objects :-(
		responseStr = err.responseStr;
		repeatStr = err.repeatStr;
	}

	emit(alexa, responseStr, repeatStr, result.cmdPromise);
}	

function pressRemoteButton(alexa, remoteButtonSlot, pressCountSlot, cmdPromise) { 
	var result = {'cmdPromise': cmdPromise, 'done': false};
	var pressCount = (typeof pressCountSlot.value == 'undefined' || pressCountSlot.value == null) ? 1 : pressCountSlot.value;
	
	console.log("pressRemoteButton: remoteButton=" + remoteButtonSlot.value + " pressCount=" + pressCount);

	if (remoteButtonSlot.value == null || typeof remoteButtonSlot.value == 'undefined')
		throw {
			'responseStr': "Sorry, I didn't understand your request. Please try again.",
			'repeatStr': ALEXA_REQUEST_BUTTON
		};	
	var remoteButtonResult = slot(remoteButtonSlot);
	if (remoteButtonResult) { // We were able to match the button
		if (remoteButtonResult.id == 'Done') { // User requested to end the session; TODO this should be implemented as separate Done Intent
			result.cmdPromise = endSession();
			result.done = true;
		}
		else {
			var deviceCmdForButton = getDeviceCmdForButton(alexa.attributes['TVSOURCE'], remoteButtonResult.id); // Get device command for device that is current TV source
			if (typeof deviceCmdForButton == 'undefined') { // Requested button is not supported by current device
				console.log("Button " + remoteButtonResult.value + " not supported by " + alexa.attributes['TVSOURCE']);
				throw {
					'responseStr': "Sorry, the " + remoteButtonResult.value + " button is not supported by your " + Config.device[alexa.attributes['TVSOURCE']]['name'] + ". Please try again.",
					'repeatStr': ALEXA_REQUEST_BUTTON
				};
			}
			else { // valid button
				// Check if we need to inject a play command to prevent "runaway winding" (user is actively winding, but then pressed a non-winding key, which was probably a mistake and leads to continued winding)
				var wasWinding = alexa.attributes['WINDING'];
				// Update whether we are currently winding
				alexa.attributes['WINDING'] = (remoteButtonResult.id == 'FastForward') || (remoteButtonResult.id == 'Rewind');
				// If we were actively winding and now no longer wind and button is not stop/pause/play then we inject a play command to prevent "runaway winding"
				if (wasWinding && !alexa.attributes['WINDING'] && ((remoteButtonResult.id != 'Play') && (remoteButtonResult.id != 'Pause') && (remoteButtonResult.id != 'Stop'))) {
					var playCmd = getDeviceCmdForButton(alexa.attributes['TVSOURCE'], 'Play');
					if (typeof playCmd != 'undefined') // Make sure play command is supported for current device
						result.cmdPromise = sendCmd({'item': alexa.attributes['TVSOURCE'], 'cmd': playCmd}, result.cmdPromise);
				}
				
				// Repeat our itemCmd "pressCount" times
				var itemCmd = {'item': alexa.attributes['TVSOURCE'], 'cmd': deviceCmdForButton};
				for(var i = 0; i < pressCount; i++)
					result.cmdPromise = sendCmd(itemCmd, result.cmdPromise);
			}
		}
	}
	else { // Can't serve the request because remoteButtonResult can't be matched
		throw {
			'responseStr': "Sorry, the " + remoteButtonSlot.value + " button is not supported by your " + Config.device[alexa.attributes['TVSOURCE']]['name'] + ". Please try again.",
			'repeatStr': ALEXA_REQUEST_BUTTON
		};
	}
	return result;
}

// Convert button id to device specific button command
function getDeviceCmdForButton(device, remoteButtonId) {
	if (typeof Config.device == 'undefined')
		throw "Config is missing device property";
	if (typeof Config.device[device] == 'undefined')
		throw "Config.device is missing " + device + " property";
	if (typeof Config.device[device]['buttons'] == 'undefined')
		throw "Config.device." + device + " is missing buttons property";

	var deviceCmdForButton = Config.device[device]['buttons'][remoteButtonId];
	console.log("getDeviceCmdForButton: deviceCmdForButton=" + deviceCmdForButton);
	return deviceCmdForButton;
}

// Switch TV input to new device tvSourceSlot. Future button presses will be sent to this new device.
function switchTVSource(alexa, tvSourceSlot) {
	console.log("switchTVSource");

	var currentTVSource = alexa.attributes['TVSOURCE'];
	var tvSourceResult = slot(tvSourceSlot); 
	if (tvSourceResult) {
		alexa.attributes['TVSOURCE'] = tvSourceResult.id; // Maintain new source item in session so that future button presses are sent to this new device
		console.log("attributes['TVSOURCE']=" + alexa.attributes['TVSOURCE']);
		alexa.attributes['WINDING'] = false; // Reset since we have a new source
		
		var cmdPromise = null;
		if (currentTVSource == Config.skill.tv)
			cmdPromise = sendCmd({'item': Config.skill.tv, 'cmd': 'Smart'}, cmdPromise);
		cmdPromise = sendCmd({'item': Config.skill.tv, 'cmd': Config.device[tvSourceResult.id]['input']}, cmdPromise);
		emit(alexa, ALEXA_OK, ALEXA_EMPTY_REPROMPT, cmdPromise);
	}
	else {
		// Can't serve the request because TVSource can't be matched
		console.log("Can't switch to " + alexa.event.request.intent.slots.TVSource.value);
		var response = "Sorry, I don't know how to switch to the " + alexa.event.request.intent.slots.TVSource.value + ". Please try again.";
		emit(alexa, response, ALEXA_REQUEST_BUTTON);
	}
}

// Collect details about whether/how slot was matched
function slot(slot) {
	var result = null;
	if (slot.resolutions && slot.resolutions.resolutionsPerAuthority && slot.resolutions.resolutionsPerAuthority.length > 0 && slot.resolutions.resolutionsPerAuthority[0] &&
		slot.resolutions.resolutionsPerAuthority[0].status.code == 'ER_SUCCESS_MATCH') {
		// User response for slot was matched to canonical value or synonym
		result = {};
		result.value = slot.value; // Actual string that was matched with user response
		result.id = slot.resolutions.resolutionsPerAuthority[0].values[0].value.id; // id for matched slot value
		result.canonicalValue = slot.resolutions.resolutionsPerAuthority[0].values[0].value.name; // Canonical value for matched slot value
		console.log("slot: slot=" + slot.name + ",result.value=" + result.value + ",result.id=" + result.id + ",result.canonicalValue=" + result.canonicalValue);
	}
	else
		console.log("slot: Couldn't slot " + slot.value);	
		
	return result;
}

// Emit Alexa's response. If repeatStr is not specified we respond in tell mode. Otherwise we respond in ask mode. 
// If cmdPromise is specified for pending button commands we chain our emit to guarantee that emit is called after all button commands completed. 
function emit(alexa, responseStr, repeatStr, cmdPromise)
{
	if (typeof responseStr == 'undefined' || responseStr == null)
		responseStr = ALEXA_GENERAL_ERROR;
	
	var mode = (typeof repeatStr == 'undefined' || repeatStr == null) ? ':tell' : ':ask';
		
	if (typeof cmdPromise != 'undefined' && cmdPromise != null)
		cmdPromise.then(function(result) {	
			console.log("emit responseStr=" + responseStr + ",repeatStr=" + repeatStr);
			alexa.emit(mode, responseStr, repeatStr);
		}, function(err) {
			alexa.emit(':tell', ALEXA_GENERAL_ERROR);
		});		
	else {
		console.log("emit responseStr=" + responseStr + ",repeatStr=" + repeatStr);
		alexa.emit(mode, responseStr, repeatStr);
	}
}

// Send button command asynchronously via web service.
// If cmdPromise is specified we chain our web service execution behind cmdPromise. This ensures ordered execution of button commands.
// We return the promise for our web service execution for additional future chaining. 
function sendCmd(itemCmd, cmdPromise) {
	if (itemCmd == null)
	{
		var err = new Error("itemCmd mustn't be null");
		console.log("sendCmd: " + err);
		throw err;
	}

	console.log("sendCmd: itemCmd['item']=" + itemCmd['item'] + ",['cmd']=" + itemCmd['cmd']);
	if (itemCmd['item'] == null)
		console.log("Warning: Sending to null item will cause error");

	if (Config.skill.serviceHost != '111.111.111.111') // Skip actual web service call for dummy IP for testing purposes
		if (cmdPromise == null)
			cmdPromise = callWebService(itemCmd, Config.skill.serviceHost, Config.skill.servicePort); // First call goes out straight away
		else
			cmdPromise = cmdPromise.then(callWebService.bind(null, itemCmd, Config.skill.serviceHost, Config.skill.servicePort)); // Subsequent calls are chained

	return cmdPromise;
}

// Actual web service invocation
function callWebService(itemCmd, serviceHost, servicePort) {
	return new Promise(function(resolve, reject) {
		console.log("callWebService: start");
		const options = {
			host: serviceHost,
			port: servicePort,
			path: '/rest/items/' + itemCmd['item'],
			method: 'POST',
			headers: {
				'Content-Type': 'text/plain',
				'Accept': 'application/json'
			}
		};
		const request = Http.request(options, function(response) {
			if (response.statusCode !== 200) {
				response.resume(); // Consume response data to free up memory
				var err = new Error("Invalid status code: " + response.statusCode);
				console.log("err=" + err);
				reject(err);
				return;
			}
			response.on('data', function (chunk) {
			});
			response.on('end', function() {	// Successful request completion
				console.log("callWebService: end");
				resolve('ok');
			});
		});
		request.on('error', (e) => {			// Couldn't connect
			console.log("Couldn't connect, " + e);
			reject(e);
		});
		request.write(itemCmd['cmd']);	// Post the command
		request.end();
	});
}

function abort() {
	emit(this, "Ok. Remote control cancelled.");	
}