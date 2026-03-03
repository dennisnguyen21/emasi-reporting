export function getAuth() { return {}; }
export async function signInAnonymously() { }
export async function signInWithCustomToken() { }
export function onAuthStateChanged(auth, callback) {
    setTimeout(() => callback({ uid: 'mock-user' }), 100);
    return () => { };
}
