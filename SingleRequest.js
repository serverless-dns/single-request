/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

var DnsWork = require("@serverless-dns/dns-blocker").DnsWork
class SingleRequest {
	constructor() {
		this.flow = []
		this.responseBlocklistUintarr = ""
		this.responseBlocklistTag = ""
		this.responseB64flag = ""
		this.UserId = ""
		this.DeviceId = ""
		this.DomainName = ""
		this.startTime = new Date()
		this.domainNameFrom = "cache"
		this.EncodedDnsPacket = undefined
		this.DecodedDnsPacket = undefined
		this.httpRequest = undefined
		this.httpResponse = undefined
		this.UserConfig = false
		this.UserInfo = false
		this.DomainNameInfo = false
		this.IsException = false
		this.exception = undefined
		this.exceptionFrom = ""
		this.IsDnsParseException = false
		this.Debug = true
		this.IsDnsBlock = false
		this.IsCnameDnsBlock = false
		this.IsInvalidFlagBlock = false
		this.StopProcessing = false
	}

	AddFlow(data) {
		if (this.Debug) {
			this.flow.push(data)
		}
	}

	async RethinkModule(commonContext, thisRequest, event) {
		let retryCount = 0;
		let retryLimit = 5;
		while (commonContext.NowLoading == true) {
			if (retryCount >= retryLimit) {
				break
			}
			await sleep(10)
			retryCount++
		}
		if (commonContext.loaded == true) {
			await thisRequest.Init(event, commonContext)
		}
		else {
			thisRequest.StopProcessing = true
			thisRequest.CustomResponse("SingleRequest.js RethinkModule","Problem in loading commonContext")
		}
	}

	async Init(event, commonContext) {
		try {
			let dns = new DnsWork()
			this.httpRequest = event.request
			getsetUserDeviceId.call(this, new URL(this.httpRequest.url))			
			loadUserFromCache.call(this, commonContext)
			try {
				let tmpReq = await this.httpRequest.clone();
				this.DecodedDnsPacket = await dns.Decode(await tmpReq.arrayBuffer())
				this.DomainName = this.DecodedDnsPacket.questions[0].name.trim().toLowerCase()
				this.DomainNameInfo = this.GetDomainInfo(commonContext, this.DomainName, event)
			}
			catch (e) {
				this.StopProcessing = true
				this.IsDnsParseException = true
				this.exception = e
				this.exceptionFrom = "SingleRequest.js SingleRequest Init"
			}
		}
		catch (e) {
			this.StopProcessing = true
			this.IsException = true
			this.exception = e
			this.exceptionFrom = "SingleRequest.js SingleRequest Init"
		}
	}

	GetDomainInfo(commonContext, DomainName, event) {
		let DomainNameInfo = commonContext.DomainNameCache.Get(DomainName)

		if (DomainNameInfo == false) {
			this.AddFlow("Domain Name From filter")
			this.domainNameFrom = "filter"
			DomainNameInfo = {}
			DomainNameInfo.k = DomainName
			DomainNameInfo.data = {}
			DomainNameInfo.data.IsDomainNameInBlocklist = true
			var searchResult = commonContext.BlockListFilter.Blocklist.hadDomainName(DomainName)
			if (searchResult) {
				DomainNameInfo.data.searchResult = searchResult
			}
			else {
				DomainNameInfo.data.IsDomainNameInBlocklist = false
			}
		}
		else {
			this.AddFlow("Domain Name From Cache")
		}
		commonContext.DomainNameCache.Put(DomainNameInfo, event)
		return DomainNameInfo
	}

	DnsExceptionResponse() {
		let singleLog = {}
		let dns = new DnsWork()
		singleLog.ErrFrom = this.exceptionFrom
		singleLog.errstack = this.exception.stack
		let DnsEncodeObj = dns.Encode({
			type: 'response',
			flags: 1
		});
		let res = new Response(DnsEncodeObj)
		this.httpResponse = new Response(res.body, res)
		this.httpResponse.headers.set('x-err', JSON.stringify(singleLog))
		this.httpResponse.headers.set('Content-Type', 'application/dns-message')
		this.httpResponse.headers.set('Access-Control-Allow-Origin', '*')
		this.httpResponse.headers.set('Access-Control-Allow-Headers', '*')
		this.httpResponse.headers.append('Vary', 'Origin')
		this.httpResponse.headers.set('server', 'bravedns')
		this.httpResponse.headers.delete('expect-ct')
		this.httpResponse.headers.delete('cf-ray')
	}

	CustomResponse(from, brief) {
		let singleLog = {}
		let dns = new DnsWork()
		singleLog.StopFrom = from
		singleLog.Reason = brief
		let DnsEncodeObj = dns.Encode({
			type: 'response',
			flags: 1
		});
		let res = new Response(DnsEncodeObj)
		this.httpResponse = new Response(res.body, res)
		this.httpResponse.headers.set('x-err', JSON.stringify(singleLog))
		this.httpResponse.headers.set('Content-Type', 'application/dns-message')
		this.httpResponse.headers.set('Access-Control-Allow-Origin', '*')
		this.httpResponse.headers.set('Access-Control-Allow-Headers', '*')
		this.httpResponse.headers.append('Vary', 'Origin')
		this.httpResponse.headers.set('server', 'bravedns')
		this.httpResponse.headers.delete('expect-ct')
		this.httpResponse.headers.delete('cf-ray')
	}


	DnsBlockResponse() {
		try {
			let dns = new DnsWork()
			this.DecodedDnsPacket.type = "response";
			this.DecodedDnsPacket.rcode = "NOERROR";
			this.DecodedDnsPacket.flags = 384
			this.DecodedDnsPacket.flag_qr = true;
			this.DecodedDnsPacket.answers = [];
			this.DecodedDnsPacket.answers[0] = {}
			this.DecodedDnsPacket.answers[0].name = this.DecodedDnsPacket.questions[0].name
			this.DecodedDnsPacket.answers[0].type = this.DecodedDnsPacket.questions[0].type
			this.DecodedDnsPacket.answers[0].ttl = 300
			this.DecodedDnsPacket.answers[0].class = "IN"
			this.DecodedDnsPacket.answers[0].data = "0.0.0.0"
			this.DecodedDnsPacket.answers[0].flush = false
			if (this.DecodedDnsPacket.questions[0].type == "A") {
				this.DecodedDnsPacket.answers[0].data = "0.0.0.0"
			}
			else {
				this.DecodedDnsPacket.answers[0].data = "::"
			}
			let res = new Response(dns.Encode(this.DecodedDnsPacket))
			this.httpResponse = new Response(res.body, res)
			this.httpResponse.headers.set('Content-Type', 'application/dns-message')
			this.httpResponse.headers.set('Access-Control-Allow-Origin', '*')
			this.httpResponse.headers.set('Access-Control-Allow-Headers', '*')
			this.httpResponse.headers.append('Vary', 'Origin')
			this.httpResponse.headers.set('server', 'bravedns')
			this.httpResponse.headers.delete('expect-ct')
			this.httpResponse.headers.delete('cf-ray')
			this.httpResponse.headers.set('x-nile-flags', this.responseB64flag)
		}
		catch (e) {
			this.IsException = true
			this.StopProcessing = true
			this.IsDnsParseException = true
			this.exception = e
			this.exceptionFrom = "SingleRequest.js SingleRequest DnsBlockResponse"
		}
	}
}

const sleep = ms => {
	return new Promise(resolve => {
		setTimeout(resolve, ms);
	});
};

function loadUserFromCache(commonContext) {
	this.UserConfig = commonContext.UserConfigCache.Get(this.UserId)
	this.UserInfo = commonContext.UserInfoCache.Get(this.UserId)
}

function getsetUserDeviceId(Url) {
	let tmpsplit = Url.pathname.split('/')
	if (tmpsplit.length > 1) {
		if (tmpsplit[1].toLowerCase() == "dns-query") {
			this.UserId = tmpsplit[2] || ""
			this.DeviceId = tmpsplit[3] || ""
		}
		else {
			this.UserId = tmpsplit[1] || ""
			this.DeviceId = tmpsplit[2] || ""
		}
	}
	this.UserId = this.UserId.trim()
	this.DeviceId = this.DeviceId.trim()
}


module.exports.SingleRequest = SingleRequest