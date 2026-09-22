// Only address-bar input is converted. Agent navigation retains explicit URLs.
export function addressTarget(input){
 const value=input.trim();if(!value)return null;
 if(/^https?:\/\//i.test(value))return value;
 // Explicit schemes stay explicit so existing URL policy can reject them.
 if(/^[a-z][a-z\d+.-]*:/i.test(value)&&!/^localhost:\d+(?:[/?#]|$)/i.test(value)&&!/^([\w-]+\.)+[\w-]+:\d+(?:[/?#]|$)/.test(value))return value;
 if(!/\s/.test(value)&&/^(?:localhost(?::\d+)?|(?:[\w\u0080-\uFFFF-]+\.)+[\w\u0080-\uFFFF-]+(?::\d+)?|\[[\da-f:]+\](?::\d+)?)(?:[/?#].*)?$/i.test(value))return 'https://'+value;
 return 'https://www.google.com/search?q='+encodeURIComponent(value);
}
