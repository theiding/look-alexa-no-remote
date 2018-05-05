# Look Alexa, no Remote!
[Watch the skill in action (Coming soon)](XXX)

Eliminate the need for any physical remote controls and instead control all of your entertainment devices entirely through Alexa using voice commands.

Remote controls are frustrating	- they are never where you need them. With Alexa the opportunity has finally arrived to get rid of those infrared foes. But unfortunately there is no existing Alexa skill that can truly replace remote controls. Sure, via Alexa's Smart Home skills you can turn your TV on and off, control volume, issue playback command and invoke predefined activities - no problem. But how do you complete more complex tasks like watching your latest recording, pick a movie on your Apple TV or change your TV settings? 

This project aims to fill the gap. Plus it hopefully serves as a helpful tutorial in general on how to create your own non-trivial Alexa skill. 

You will [run the Alexa skill in AWS](#1-alexa-skill-setup) and [provide a web service to send remote control commands](#2-remote-control-web-service-setup) on a server of your choice (based on [openHAB](http://www.openhab.org) and [Harmony Hub](https://www.logitech.com/en-us/product/harmony-hub) if you leverage the [sample web service implementation](#2-2-sample-rest-api-implementation-with-openhab)). 


# 1. Alexa Skill Setup
[Watch the Alexa skill setup process (Coming soon)](XXX)

## 1.1. Prerequisites
1. [Setup of ASK CLI](https://developer.amazon.com/docs/smapi/quick-start-alexa-skills-kit-command-line-interface.html) (version 1.1.2 or newer)
2. [Install npm](https://nodejs.org/en/download/)

## 1.2. Installation
1. Download the repository
	```
	$ git clone https://github.com/theiding/look-alexa-no-remote
	```
	If you don't want to use git, go to <https://github.com/theiding/look-alexa-no-remote>, click on "Clone or download", "Download ZIP" and unzip the source code.
    
2. Install Node.js dependencies for AWS Lambda function
	```
	$ cd look-alexa-no-remote/alexa/remote-control/lambda/custom
	$ npm install
	```
3. Create your own configuration files from the sample files
 	```bash
	$ cp config.js.sample config.js
	$ cd ../../models
	$ cp en-US.json.sample en-US.json
	```
4. Create and deploy skill and lambda function
	```
	$ cd ..
	$ ask deploy
	```

## 1.3. Testing
You can now test your skill. Of course there won't be any remote control command execution yet since we haven't yet [setup the remote control web service](#2-remote-control-web-service-setup), but we can start interacting with Alexa and review logging output from our Lambda function. 
1. Use the skill
	
    Tell Alexa the following and verify Alexa's responses
	```
	"Alexa, remote control" -> "Ok, ready."
	"Right" -> "Ok"
	"Switch to Apple TV" -> "Ok"
	"Done" -> "Ok. Done."
	```
2. Review Lambda logs
	
	[Go to the logs for your Lambda function](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-functions-logs.html).
	Verify that each button command was logged correctly by looking for the respective `sendCmd` log entries:

	- `sendCmd: itemCmd['item']=EntertainmentBedroomTV,['cmd']=Mute` This "Mute" command is sent to your TV when the session is started. This is to avoid any interference from the TV sound with subsequent commands.
    - `sendCmd: itemCmd['item']=EntertainmentBedroomDVR,['cmd']=DirectionRight` The "Right" button is sent in direct response to the "Right" voice command.
	- `itemCmd['item']=EntertainmentBedroomTV,['cmd']=InputHDMI2` Switching to Apple TV is executed by changing the input on the TV via the input command.
	- `sendCmd: itemCmd['item']=EntertainmentBedroomTV,['cmd']=Mute` We unmute the TV (by toggling "Mute") when our session ends.
	
## 1.4. Configuration
Now let's configure the skill to handle your own entertainment devices.
1. Voice model

	The voice model leverages a list of buttons and devices to define what set of buttons and devices are allowed in skill invocations. Configure the list of buttons and devices by editing `look-alexa-no-remote/alexa/remote-control/models/en-US.json`:
	- List of buttons

		Find the `LIST_OF_REMOTE_BUTTONS`. This list defines all the remote buttons that are suppported for your devices.
        
		Each entry contains an `id` that uniquely identifies a button in a device independent fashion (e.g. `DirectionUp` identifies the "Up" button, wether it's for an Apple TV, a DVR or some other device).
		The `value` entry specifies how the user can refer to the button. If you want to allow multiple names use the `synonynm` entry (e.g. in the sample config file the user can call the "Ok" button `ok`, `enter` or `select`).
        
		Update the list by removing buttons you don't need or by adding ones that are missing for your setup.
	- <a id="list-of-devices"></a>List of devices

		Find the `LIST_OF_TV_SOURCES`. This list defines all the devices that are suppported.
        
		Each entry contains an `id` that uniquely identifies the device. The device id will be sent in the [REST API call for each button command](#2-1-rest-api).
        
		The `value` entry specifies how the user can refer to the device. If you want to allow multiple names use the `synonynm` entry (e.g. in the sample config file the user can call the TV `TV` or `television`).
        
		Update the list by removing devices you don't need or by adding ones that are missing for your setup. <br>
2. Skill and devices configuration

	Provide general skill and device configuration by editing `look-alexa-no-remote/alexa/remote-control/lambda/custom/config.js`:
	- <a id="skill-configuration"></a>Skill - Configure the general skill settings in the `skill` object. Follow the comments next to each property. 
	- <a id="skill-configuration"></a>Devices - For each device that you defined in the [list of devices](#list-of-devices)  above specify a section in the `device` object with the name of the device id. Within each device id object provide:
		- <a id="button-command-configuration"></a>`buttons` - The buttons map maps the button id to a device and web service specific button command. The device specific button command is sent in the REST API call (not the generic button id). Note that in most cases button id and button command are the same, but at times they differ (e.g. a Harmony Hub based web service will expect button command `OK` for the "OK" button for an Xfinity DVR, but `Select` for the "OK" button for an Apple TV).
		
			If a button doesn't have a map entry then that means it is not supported by the device.<br>
		- `input` - Specify the TV's button command needed to change the TV's input to the given device.
		- `name` - Specify a user friendly name for the device. The skill uses this value for user friendly error messages.
	
    	Remove the device id objects that you don't need (e.g. `EntertainmentBedroomDVR`).
        
3. Re-deploy your configuration changes
	```
    $ cd look-alexa-no-remote/alexa/remote-control
	$ ask deploy
	```

# 2. Remote Control Web Service Setup
The skill is calling a web service for each requested button press. The web service is responsible for sending the actual button command to the various devices.

## 2.1 REST API
Each button command is sent using the following REST API invocation:
```
{serviceHost}:{servicePort}/rest/items/{item}
```
with body
```
{cmd}
```
where
- `{serviceHost}` is the host configured in the [skill configuration](#skill-configuration)
- `{sericePort}` is the port configured in the [skill configuration](#skill-configuration)
- `{item}` is the name of the device receiving the command as configured in the [devices configuration](#devices-configuration)  (e.g. `EntertainmentBedroomDVR` for the sample config file)
- `{cmd}` is the name of the button command for the device as configured in the [button command configuration](#button-command-configuration)(e.g. `Select` for `EntertainmentBedroomAppleTV` from the sample config file)

For example with the sample files a request to press the "OK" button on the Apple TV would be sent to 
```
111.111.111.111:8080/rest/items/EntertainmentBedroomAppleTV
```
with body
```
Select
```
You can implement this REST API in whatever fashion best matches your existing system setup or you can use the provided sample implementation below.

## 2.2 Sample REST API Implementation with openHAB
This implementation of the above [REST API](#2-1-rest-api) leverages [openHAB](http://www.openhab.org) and [Harmony Hub](https://www.logitech.com/en-us/product/harmony-hub). 

### 2.2.1. Prerequisites
1. [Install openHAB](https://docs.openhab.org/installation/index.html)(version 2.1 or newer)
2. [Install Harmony Hub](https://support.myharmony.com/en-au/hub)

### 2.2.2 openHAB Configuration
1. Create your own `.things` and `.items` file from the sample files
	```
	$ cd look-alexa-no-remote/openhab
	$ cp remote-control.things.sample remote-control.things
	$ cp remote-control.items.sample remote-control.items
	```
2. <a id="thing"></a>Edit "thing"
	
    Edit `look-alexa-no-remote/openhab/remote-control.things`. This file [integrates your Harmony Hub with openHAB](https://docs.openhab.org/addons/bindings/harmonyhub/readme.html) by defining a "thing" that represents the Harmony Hub.
    - Replace the host IP with the IP for your Harmony Hub (make sure it has a static IP that won't change with reboots).
    - For each of your entertainment devices enter one line of the following format:
    	```
		device {deviceThingName} [name="{deviceHarmonyHubName}"]
    	```
		where
		- `{deviceThingName}` is the name you define for your device in openHAB
		- `{deviceHarmonyHubName}` is the name of the device as configured in the Harmony Hub
	
    	Example: `device bedroomTV [name="Bedroom TV"]`

3. Edit "items"

	Edit `look-alexa-no-remote/openhab/remote-control.items`. This file defines an openHAB item for each device and [exposes the respective remote control web service](https://docs.openhab.org/configuration/restdocs.html).
    
    For each of your entertainment devices enter one line of the following format:
	```
	String {item} { channel="harmonyhub:device:main:{deviceThingName}:buttonPress" }
	```
	where
	- `{item}` is the name of the device configured in the [list of devices](#list-of-devices)
	- `{deviceThingName}`is the device thing name you defined [above](#thing).
	
    Example: `String EntertainmentBedroomTV { channel="harmonyhub:device:main:bedroomTV:buttonPress" }`
4. Copy your configuration files to your openHAB server. 

	[File destination location](https://docs.openhab.org/installation/linux.html#file-locations) depends on your openHAB install. For a repository installation:
	``` 
	cd look-alexa-no-remote/openhab
	cp remote-control.things /etc/openhab2/things
	cp remote-control.items /etc/openhab2/items
	``` 
5. Start openHAB Server	

	[Start your openHAB server depending on your installation method](https://docs.openhab.org/installation/index.html) so it starts answering REST API calls.
    
6. Update host and port configuration

	In [the skill configuration](#skill-configuration) update
	- `serviceHost` to the IP of the device running your openHAB server. Make sure the IP is publicly visible so your Lambda function can reach it while [considering security implications](https://docs.openhab.org/installation/security.html). 
	- `servicePort` to `8080`

# 2.2.3 Testing
1. Trigger a manual REST API call from the command line:
	```
	curl -X POST --header "Content-Type: text/plain" --header "Accept: application/json" -d "{cmd}" 	"http://{serviceHost}:8080/rest/items/{item}"
	```
	where
	- `{cmd}` is the button command you want to test
	- `{serviceHost}` is the IP of the device running your openHAB server
	- `{item}` is the openHAB item for the device you want to test
	    
	Example:
	```
	curl -X POST --header "Content-Type: text/plain" --header "Accept: application/json" -d 	"DirectionRight" "http://111.111.111.111:8080/rest/items/EntertainmentBedroomDVR"
	```
	Your test command should now execute on your test device. 
2. End to End Test
	
    Execute remote control commands via Alexa and throw away your remote controls.
# 3. Troubleshooting FAQ
1. How do I troubleshoot my Alexa skill?

	Always start by [reviewing your Lambda function logs](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-functions-logs.html). 
2. How can I test my Alexa skill without having implemented the remote control web service?

	Simply [configure `serviceHost`](skill-configuration) as `111.111.111.111`. This will supress the actual REST API call. 
3. Yikes, my `en-US.json` file is messed up somehow, but I don't know where. Help!

	Validate your json file with <https://jsonlint.com>.
4. That config.js file is gnarly to edit. How do I know I got it right before I deploy?

	Validate your .js file with <http://esprima.org/demo/validate.html>.
4. My openHAB implementation of the REST API doesn't work. What to do?
	
    Start by [reviewing openHAB log files](https://docs.openhab.org/administration/logging.html).
	- `events.log` logs all commands sent to your items over the openHAB message bus via the REST API call, e.g. 
		```
    	[ItemCommandEvent] - Item 'EntertainmentBedroomDVR' received command DirectionRight
        ```
	- `openhab.log` logs miscellaneous operational information. In particular make sure there are no errors re. your items, things and Harmony Hub binding.