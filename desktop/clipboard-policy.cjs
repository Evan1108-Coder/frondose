'use strict';
function clipboardText(value){if(typeof value!=='string'||value.length>100000||value.includes('\0'))throw Error('Choose bounded text to copy.');return value;}
module.exports={clipboardText};
