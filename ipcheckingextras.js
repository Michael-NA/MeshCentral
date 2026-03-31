
/*xjslint node: true */
/*xjslint plusplus: true */
/*xjslint maxlen: 256 */
/*jshint node: true */
/*jshint strict: false */
/*jshint esversion: 6 */
'use strict';

const fs = require('fs');
const path = require('path');
const { URL, urlToHttpOptions } = require('url');
const { Agent, request } = require('https');
const reqagent = new Agent({
    timeout: 5000, // Socket connection timeout in milliseconds (5 seconds)
    keepAlive: true, // Optional: Reuse connections
    maxSockets: 10, // Optional: Limit concurrent connections
  });

//Basic expiry of entries. No value stored. Just the key (and the timestamp)
class ExpiringMap {
    constructor() {
        this.map = new Map();
    }
    set(key, ttl = 3600000) { // 1 hour default in milliseconds
        if (typeof key === 'undefined' || key === null) return;
        if (typeof ttl !== 'number' || ttl <= 0) return;
        const expiry = Date.now() + ttl;
        this.map.set(key, expiry);
        return this; // for chaining
    }
    get(key) {
        const item = this.map.get(key);
        if (!item) return undefined;
        
        if (Date.now() > item) {
            this.map.delete(key);
            return undefined;
        }
        return item;
    }
    has(key) {
        const item = this.map.get(key);
        if (!item) return false;
        return true;
    }
    delete(key) {
        return this.map.delete(key);
    }
    cleanup() {
        const now = Date.now();
        for (const [key, item] of this.map) {
            if (now > item) {
                this.map.delete(key);
            }
        }
    }
    startCleanupInterval(interval = 3600000 * 6) { // 6hrs
        // clearInterval(cleanupId); // To stop it later if needed
        return setInterval(() => this.cleanup(), interval);
    }        
}

const ipcache = new Set();
const ipcacheBad = new ExpiringMap();
const cleanupId = ipcacheBad.startCleanupInterval();

//API URL is format of "https://api.www.com/apiresource?ip={{agentip}}"
//Response should be simply app-json {hasip: true}
module.exports.ExternalIsIPAllowed = function (ip, apiurl) { 
    if(ipcache.has(ip)){
        return true;
    }
    if(ipcacheBad.has(ip)){
        return false;
    }

    apiurl = apiurl.replace("{{ipaddr}}", ip);
    const data = makeRequest( apiurl).then((data) =>{
        var resultObj = JSON.parse(data);
        if(ip == "::1") resultObj.hasip = true;
        if(resultObj.hasip){
            ipcache.add( ip);
        }else {
            ipcacheBad.set( ip);
        }
    });

    return false;
};


function makeRequest(url) {
    return new Promise((resolve, reject) => {
        //Unable to get the timeout to be less than 20s.  
        var options = urlToHttpOptions( new URL( url));
        options.timeout = 5000;//response timeout, post connection (i.e contactable, but slow)
        options.agent = reqagent;

        const req = request(url, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                resolve(data); // Resolve with the full response
            });
        });

        req.on('error', (err) => {
            reject(err); // Reject on error
        });

        req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('Request timed out'));
        });

        req.end();
    });
}

/*
Usage, but it needs to be synchronous so we can kill the socket right away.
NodeJS doesnt seem to offer this.
Instead we will just reject connection, and let them retry - at which point it will be in ipcache

    var ipcheckingextras = null;
    if (args.agentallowedip_api != null){
        ipcheckingextras = require('./ipcheckingextras');
        var result = await ExternalIsIPAllowed
        console.log("ipcheck", result);
    }

    */

