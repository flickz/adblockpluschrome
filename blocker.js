// This file (c) T. Joseph <ttjoseph@gmail.com>
// Everyone can use, modify and distribute this file without restriction.

// ABP content type flags
var TypeMap = {
  OTHER: 1, SCRIPT: 2, IMAGE: 4, STYLESHEET: 8, OBJECT: 16,
  SUBDOCUMENT: 32, DOCUMENT: 64, BACKGROUND: 256, XBL: 512,
  PING: 1024, XMLHTTPREQUEST: 2048, OBJECT_SUBREQUEST: 4096,
  DTD: 8192, MEDIA: 16384, FONT: 32768, ELEMHIDE: 0xFFFD
};

var TagToType = {
    "SCRIPT": TypeMap.SCRIPT,
    "IMG": TypeMap.IMAGE,
    "STYLE": TypeMap.STYLESHEET,
    "OBJECT": TypeMap.OBJECT,
    "EMBED": TypeMap.OBJECT,
    "IFRAME": TypeMap.SUBDOCUMENT
};

var enabled = false; // Enabled for this particular domain.
var serial = 0; // ID number for elements, indexes elementCache
var elementCache = new Array(); // Keeps track of elements that we may want to get rid of
var nukeElementsTimeoutID = 0;

// Special cases
var specialCaseYouTube = false;
var pageIsYouTube = false;

// Click-to-hide stuff
var clickHide_activated = false;
var currentElement = null;
var currentElement_border = "";
var currentElement_backgroundColor;
var clickHideFilters = null;
var highlightedElementsSelector = null;
var highlightedElementsBorders = null;
var highlightedElementsBGColors = null;

// Open a port to the extension
var port = chrome.extension.connect({name: "filter-query"});

// Nuke a particular element.
function nukeSingleElement(elt) {
    if(elt.innerHTML) elt.innerHTML = "";
    if(elt.innerText) elt.innerText = "";
    // Probably vain attempt to stop scripts
    if(elt.tagName == "SCRIPT" && elt.src) elt.src = "";
    if(elt.language) elt.language = "Blocked!";
    elt.style.display = "none !important";
    elt.style.visibility = "hidden !important";

    var pn = elt.parentNode;
    if(pn) pn.removeChild(elt);

    // Get rid of OBJECT tag enclosing EMBED tag
    if(pn && pn.tagName == "EMBED" && pn.parentNode && pn.parentNode.tagName == "OBJECT")
        pn.parentNode.removeChild(pn);    
}

// Replaces our stylesheet with elemhide rules. This would in principle
// nuke the initial image, iframe, Flash hiding rules.
// Sometimes there is, for some reason, more than one AdThwart stylesheet,
// so we replace all that we find.
function removeInitialBlockStylesheet() {
    if(typeof styleElm == "undefined" || !styleElm) return;
    var theStyleElm = $("style[title=\"__adthwart__\"]").each(function(i) {
        this.innerText = getElemhideCSSString();
    });
}

// Set up message handlers. These remove undesirable elements from the page.
port.onMessage.addListener(function(msg) {
    if(msg.shouldBlockList && enabled == true) {
        var ptr = 0;
        for(var i = 0; i < elementCache.length; i++) {
            if(i == msg.shouldBlockList[ptr]) {
                // It's an ad, nuke it
                nukeSingleElement(elementCache[i]);
                ptr++;
            }
        }
        // Take away our injected CSS, leaving only ads hidden
        removeInitialBlockStylesheet();
    }
});

chrome.extension.onRequest.addListener(function(request, sender, sendResponse) {
    // background.html might want to know this document's domain
    if(request.reqtype == "get-domain") {
        sendResponse({domain: document.domain});
    } else if(request.reqtype == "clickhide-active?") {
        // No longer used...
        sendResponse({isActive: clickHide_activated});
    } else if(request.reqtype == "clickhide-activate") {
        clickHide_activate();
    } else if(request.reqtype == "clickhide-deactivate") {
        clickHide_deactivate();
    } else if(request.reqtype == "remove-ads-again") {
        // Called when a new filter is added
        removeAdsAgain();
    } else
        sendResponse({});
});

// Highlight elements according to selector string. This would include
// all elements that would be affected by proposed filters.
function highlightElements(selectorString) {
    if(highlightedElementsSelector)
        unhighlightElements();
    
    highlightedElements = $(selectorString);
    highlightedElementsSelector = selectorString;
    highlightedElementsBorders = new Array();
    highlightedElementsBGColors = new Array();

    for(var i = 0; i < highlightedElements.length; i++) {
        highlightedElementsBorders[i] = highlightedElements[i].style.border;
        highlightedElementsBGColors[i] = highlightedElements[i].style.backgroundColor;
        highlightedElements[i].style.border = "1px solid #fd6738";
        highlightedElements[i].style.backgroundColor = "#f6e1e5";
    }
}

// Unhighlight all elements, including those that would be affected by
// the proposed filters
function unhighlightElements() {
    if(highlightedElementsSelector == null)
        return;
    highlightedElements = $(highlightedElementsSelector);
    for(var i = 0; i < highlightedElements.length; i++) {
        highlightedElements[i].style.border = highlightedElementsBorders[i];
        highlightedElements[i].style.backgroundColor = highlightedElementsBGColors[i];
    }
    highlightedElementsSelector = null;
}

// Turn on the choose element to create filter thing
function clickHide_activate() {
    if(document == null) return;
    
    if(currentElement) {
        currentElement.style.border = currentElement_border;
        currentElement.style.backgroundColor = currentElement_backgroundColor;
        currentElement = null;
        clickHideFilters = null;
    }
    clickHide_activated = true;
    document.addEventListener("mouseover", clickHide_mouseOver, false);
    document.addEventListener("mouseout", clickHide_mouseOut, false);
    document.addEventListener("click", clickHide_mouseClick, false);
    document.addEventListener("keyup", clickHide_keyUp, false);
}

// Called when user has clicked on something and we are waiting for confirmation
// on whether the user actually wants these filters
function clickHide_rulesPending() {
    clickHide_activated = false;
    document.removeEventListener("mouseover", clickHide_mouseOver, false);
    document.removeEventListener("mouseout", clickHide_mouseOut, false);
    document.removeEventListener("click", clickHide_mouseClick, false);
    document.removeEventListener("keyup", clickHide_keyUp, false);
}

// Turn off click-to-hide
function clickHide_deactivate() {
    if(currentElement) {
        unhighlightElements();
        currentElement.style.border = currentElement_border;
        currentElement.style.backgroundColor = currentElement_backgroundColor;
        currentElement = null;
        clickHideFilters = null;
    }
    
    clickHide_activated = false;
    if(!document) return; // This can happen inside a nuked iframe...I think
    document.removeEventListener("mouseover", clickHide_mouseOver, false);
    document.removeEventListener("mouseout", clickHide_mouseOut, false);
    document.removeEventListener("click", clickHide_mouseClick, false);
    document.removeEventListener("keyup", clickHide_keyUp, false);
}

// Hovering over an element so highlight it
function clickHide_mouseOver(e) {
    if(clickHide_activated == false)
        return;
    
    if(e.target.id || e.target.className) {
        currentElement = e.target;
        currentElement_border = e.target.style.border;
        currentElement_backgroundColor = e.target.style.backgroundColor;
        e.target.style.border = "1px solid #d6d84b";
        e.target.style.backgroundColor = "#f8fa47";
    }
}

// No longer hovering over this element so unhighlight it
function clickHide_mouseOut(e) {
    if(!clickHide_activated || !currentElement)
        return;
    
    currentElement.style.border = currentElement_border;
    currentElement.style.backgroundColor = currentElement_backgroundColor;
}

// Selects the currently hovered-over filter
function clickHide_keyUp(e) {
    // Ctrl+Shift+E
    if(e.ctrlKey && e.shiftKey && e.keyCode == 69)
        clickHide_mouseClick(e);
}

// When the user clicks, the currentElement is the one we want.
// We should have ABP rules ready for when the
// popup asks for them.
function clickHide_mouseClick(e) {
    if(!clickHide_activated)
        return;
        
    // Eat the click event - could be a stray click. This doesn't always work.
    e.preventDefault();
    e.stopPropagation();
    // If we don't have an element, let the user keep trying
    if(!currentElement)
        return;
        
    // Construct ABP filter(s). The popup will retrieve these.
    // Only one ID
    var elementId = currentElement.id ? currentElement.id.split(' ').join('') : null;
    // Can have multiple classes...
    var elementClasses = currentElement.className ? currentElement.className.split(' ') : null;
    clickHideFilters = new Array();
    selectorList = new Array();
    if(elementId) {
        clickHideFilters.push(document.domain + "###" + elementId);
        selectorList.push("#" + elementId);
    }
    if(elementClasses) {
        for(var i = 0; i < elementClasses.length; i++) {
            clickHideFilters.push(document.domain + "##." + elementClasses[i]);
            selectorList.push("." + elementClasses[i]);
        }
    }
    
    // Save the filters that the user created
    chrome.extension.sendRequest({reqtype: "cache-filters", filters: clickHideFilters});

    // Highlight the unlucky elements
    // Restore currentElement's border and bgcolor so that highlightElements won't save those
    currentElement.style.border = currentElement_border;
    currentElement.style.backgroundColor = currentElement_backgroundColor;
    highlightElements(selectorList.join(","));
    currentElement.style.border = "1px solid #fd1708";
    currentElement.style.backgroundColor = "#f6a1b5";

    // Half-deactivate click-hide so the user has a chance to click the page action icon.
    // currentElement is still set to the putative element to be blocked.
    clickHide_rulesPending();
}

// Called when a new filter is added.
// It would be a click-to-hide filter, so it's only an elemhide filter.
// Since this rarely happens, we can afford to do a full run of ad removal.
function removeAdsAgain() {
    chrome.extension.sendRequest({reqtype: "get-elemhide-selectors", domain: document.domain}, function(response) {
        // Retrieve new set of selectors and build selector strings
        makeSelectorStrings(response.selectors);
        hideBySelectorStrings(document);
        nukeElements(document);
    });
}

// Block ads in nodes inserted by scripts
function handleNodeInserted(e) {
    // Remove ads relatively infrequently. If no timeout set, set one.
    if(enabled) {
        if(nukeElementsTimeoutID == 0)
            nukeElementsTimeoutID = setTimeout(nukeElements, 1000);
    
        if(pageIsYouTube && e.target.id == "movie_player") {
            handleYouTubeFlashPlayer(e.target);
        }
    }
}

function hideBySelectorStrings(parent) {
    if(enabled) {
        // var now = new Date().getTime();
        for(i in elemhideSelectorStrings) {
            var elts = $(elemhideSelectorStrings[i], parent).get();
            for(var i = 0; i < elts.length; i++) {
                // TODO: Sometimes style isn't defined, for some reason...
                try { elts[i].style.visibility = "hidden"; } catch(err) {}
                try { elts[i].style.display = "none"; } catch(err) {}
            }
        }        
        // console.log("That took " + ((new Date()).getTime() - now) + " ms");
    }
}

// Converts relative to absolute URL
// e.g.: foo.swf on http://example.com/whatever/bar.html
//  -> http://example.com/whatever/foo.swf 
function relativeToAbsoluteUrl(url) {
    // Leading / means absolute path
    if(url[0] == '/')
        return document.location.protocol + "//" + document.location.host + url;

    // Remove filename and add relative URL to it
    var base = document.baseURI.match(/.+\//);
    if(!base) return document.baseURI + "/" + url;
    return base[0] + url;
}

// Hides/removes image and Flash elements according to the external resources they load.
// (e.g. src attribute)
function nukeElements(parent) {
    var elts = $("img,object,iframe,embed", parent);
    var types = new Array();
    var urls = new Array();
    var serials = new Array();
    for(var i = 0; i < elts.length; i++) {
        elementCache.push(elts[i]);
        var url;
        // Check children of object nodes for "param" nodes with name="movie" that specify a URL
        // in value attribute
        if(elts[i].tagName == "OBJECT" && !(url = elts[i].getAttribute("data"))) {
            // No data attribute, look in PARAM child tags for a URL for the swf file
            var params = $("param[name=\"movie\"]", elts[i]);
            // This OBJECT could contain an EMBED we already nuked, in which case there's no URL
            if(params[0])
                url = params[0].getAttribute("value");
            else {
                params = $("param[name=\"src\"]", elts[i]);
                if(params[0]) url = params[0].getAttribute("value");
            }
        } else {
            url = elts[i].getAttribute("src");
        }

        if(url) {
            // Some rules don't include the domain, and the blacklist
            // matcher doesn't match on queries that don't include the domain
            if(!url.match(/^http/)) url = relativeToAbsoluteUrl(url);
            // Guaranteed by call to $() above to be one of img, iframe, object, embed
            // and therefore in this list
            types.push(TagToType[elts[i].tagName]);
            urls.push(url);
            serials.push(serial);
        }
        serial++;
    }
    // Ask background.html which of these elements we should nuke
    port.postMessage({reqtype: "should-block-list?", urls: urls, types: types, serials: serials, domain: document.domain});
    
    nukeElementsTimeoutID = 0;
}

// flashvars is URL-encoded and dictates what ads will be shown in this video.
function handleYouTubeFlashPlayer(elt) {
    if(specialCaseYouTube && pageIsYouTube && elt) {
        var re = /&(ad_|prerolls|invideo|interstitial|watermark|infringe).*?=.+?(&|$)/gi;
        // WTF. replace() just gives up after a while, missing things near the end of the string. So we run it again.
        var newFlashVars = elt.getAttribute("flashvars").replace(re, "&").replace(re, "&");
        var replacement = elt.cloneNode(true);
        // Doing this stuff fires a DOMNodeInserted, which will cause infinite recursion into this function.
        // So we inhibit it using pageIsYouTube.
        pageIsYouTube = false;
        replacement.setAttribute("flashvars", newFlashVars + "&invideo=false&autoplay=1");
        //console.log(replacement.getAttribute("flashvars"));
        elt.parentNode.replaceChild(replacement, elt);
        pageIsYouTube = true;
    }
}

chrome.extension.sendRequest({reqtype: "get-domain-enabled-state"}, function(response) {
    enabled = response.enabled;
    specialCaseYouTube = response.specialCaseYouTube;
    if(enabled) {
        // Hide ads by selector using CSS
        // In some weird cases the elemhide style element might not stick, so we do this.
        hideBySelectorStrings(document);
        
        // Special-case YouTube video ads because they are so popular.
        if(document.domain.match(/youtube.com$/)) {
            pageIsYouTube = true;
            var elt = document.getElementById("movie_player");
            handleYouTubeFlashPlayer(elt);
        }        
        
        // Nuke ads by src. This will also cause removal of initial-block stylesheet.
        nukeElements(document);
        document.addEventListener("DOMNodeInserted", handleNodeInserted, false);
    }
});
