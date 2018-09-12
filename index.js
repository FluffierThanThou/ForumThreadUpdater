const needle = require( "needle" );
const cheerio = require( "cheerio" );
const sha1 = require("sha1");
const merge = require("lodash.merge");
const fs = require("fs");

const FORUM = "https://ludeon.com/forums/index.php";
const FORUM_LOGIN_ACTION = FORUM + "?action=login2";

/**
 * @param {string} username Your Ludeon forums username
 * @param {string} password Your Ludeon forums password
 * @param {number} msg the ID of the message you want to alter
 * @param {string} topic the ID of the topic the message you want to alter is in
 * @param {object} contents contents of the message you want to alter, see examples
 * @param {boolean} debug should we show (very messy) debug output?
 * @returns {boolean} true if everything (appeared) to have gone correctly, false if some error occured.
 * 
 * @example
 * // update post contents;
 * Update( 'me', 'my_password', 433374, '45557.0', { message: "new post body" } );
 * 
 * // update post title; 
 * Update( 'me', 'my_password', 433374, '45557.0', { subject: "new subject" } );
 * 
 * // obviously you can combine these. Further options are;
 * // - notify (0|1)          (un)subscribe to notifications
 * // - lock (0|1)            lock topic (warning: this is irreverisible! (except for mods))
 * // - ns (null|'NS')        use smileys in this thread
 * 
 * @default 
 */
async function Update( username, password, msg, topic, contents, debug = false ){
    try {
        console.log( "obtaining session info..." );
        let login_form = await needle('get', FORUM );   
        let session = getSessionInfo( login_form );
        if ( debug ) console.dir( "Session: ", session );

        session = await login( session, username, password, debug );
        doUpdate( session, msg, topic, contents, debug );
        return true;
    } catch (e) {
        console.error( e );
        return false;
    }
}


function getSessionInfo( response ){
    var session = {
        xss: getXssInput( response ),
        cookies: response.cookies
    }
    return session;
}

function getXssInput( response ){
    var xssElement = cheerio( "form input[type=hidden]", response.body ).filter( (i, el) => el.attribs.value.length == 32 );
    var xss = {
        name: xssElement.attr("name"),
        value: xssElement.val()
    }
    // if ( DEBUG ) console.log( "XSS token: ", xss );
    return xss;
}

async function login( session, username, password, debug = false ){
    let form_data = {
        user: username,
        cookielength: -1,
        hash_passwrd: hashPassword( username, password, session.xss.value )
    }
    form_data[session.xss.name] = session.xss.value;
    console.log( "logging in..." );
    if (debug) { console.log( "login form data:"); console.dir( form_data )}
    let login = await needle( 'post', FORUM_LOGIN_ACTION, form_data, { cookies: session.cookies, follow: 5, follow_set_cookies: true } );
    let user = cheerio( "#name em", login.body ).text();
    if ( user == "Guest" )
        throw new Error( "Authentication failed!" );
    else 
        console.log( "successfully logged in as: " + user );
    merge( session.cookies, login.cookies );
    session.user = user;
    return session;
}

async function doUpdate( session, msg, topic, contents, debug ){
    console.log( "preparing update..." );
    let edit_page = await needle( 'get', getEditFormUrl( msg, topic ), { cookies: session.cookies } );
    merge( session.cookies, edit_page.cookies );
    session.xss = getXssInput( edit_page );
    if (debug) console.log( session.cookies );

    // populate form data
    let $ = cheerio.load( edit_page.body );
    let post_action = $("form#postmodify").attr("action");
    let form_data = {};
    $("form#postmodify input, form#postmodify textarea").each( function(i, element){
        el = $(this);
        if (debug) console.log( el[0].name + " :: " + el.attr("type") + " :: " + el.attr("name") + " :: " + el.val() + " :: " + ( el.attr("checked") == "checked" ) )
        if ( ( el[0].name == "input" ||  el[0].name == "textarea" ) && el.attr( "type" ) != "checkbox" && el.attr( "type" ) != "submit" ){
            form_data[el.attr("name")] = el.val();
        }
        if ( el.attr( "type" ) == "checkbox" && el.attr( "checked" ) == "checked" ){
            form_data[el.attr("name")] = el.val();
        }
    });

    // we only really want to edit the message and subject
    merge( form_data, contents );

    if (debug) { console.log( "Update data:" ); console.dir( form_data ); }
    
    // do the update
    let update = await needle( 'post', post_action, form_data, { cookies: session.cookies, follow: 5 } );

    // update complete?
    // TODO: check if update actually happened, we can't rely on status codes.
    console.log( "update completed (maybe, better check it!): https://ludeon.com/forums/index.php?topic=" + topic + ".msg" + msg + "#msg" + msg );

    if ( debug ) console.log( session );
}

function dumpBody( response, name = "dump" ){
    fs.writeFileSync( name + ".html", response.body, "utf8" );
}

function hashPassword( username, password, session_id ){
    return sha1( sha1( username.to8bit().toLowerCase() + password.to8bit()) + session_id);
}

// Convert a string to an 8 bit representation (like in PHP). Copied from SMF default template scripts, assuming charset is UTF-8
// Copied from SMF default theme script.
String.prototype.to8bit = function ()
{
    var n, sReturn = '';

    for (var i = 0, iTextLen = this.length; i < iTextLen; i++)
    {
        n = this.charCodeAt(i);
        if (n < 128)
            sReturn += String.fromCharCode(n)
        else if (n < 2048)
            sReturn += String.fromCharCode(192 | n >> 6) + String.fromCharCode(128 | n & 63);
        else if (n < 65536)
            sReturn += String.fromCharCode(224 | n >> 12) + String.fromCharCode(128 | n >> 6 & 63) + String.fromCharCode(128 | n & 63);
        else
            sReturn += String.fromCharCode(240 | n >> 18) + String.fromCharCode(128 | n >> 12 & 63) + String.fromCharCode(128 | n >> 6 & 63) + String.fromCharCode(128 | n & 63);
    }

    return sReturn;
}
function getEditFormUrl( msg, topic ){
    return `${FORUM}?action=post;msg=${msg};topic=${topic}`;
}

module.exports.default = Update;
