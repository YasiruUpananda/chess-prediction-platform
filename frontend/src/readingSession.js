const DB='neurochess-reader';
const VERSION=1;
function database() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB,VERSION);
    request.onupgradeneeded=()=>request.result.createObjectStore('documents');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
export async function readSession(key) {
  const db=await database();
  try {return await new Promise((resolve,reject)=>{
    const request=db.transaction('documents').objectStore('documents').get(key);
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });} finally {db.close();}
}
export async function writeSession(key,value) {
  const db=await database();
  try {await new Promise((resolve,reject)=>{
    const transaction=db.transaction('documents','readwrite');
    transaction.objectStore('documents').put({...value,version:VERSION,updatedAt:Date.now()},key);
    transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);
    transaction.onabort=()=>reject(transaction.error);
  });} finally {db.close();}
}
export async function deleteSession(key) {
  const db=await database();
  try {await new Promise((resolve,reject)=>{
    const transaction=db.transaction('documents','readwrite');transaction.objectStore('documents').delete(key);
    transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);
  });} finally {db.close();}
}
