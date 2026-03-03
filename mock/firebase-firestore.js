export function getFirestore() { return {}; }

let mockTasks = [];
let listeners = [];

function notifyListeners() {
    const snap = {
        docs: mockTasks.map(t => ({
            id: t.id,
            data: () => t
        }))
    };
    listeners.forEach(l => l(snap));
}

export function collection() { return {}; }

export function doc(db, ...pathSegments) {
    return { path: pathSegments.join('/') };
}

export async function setDoc(docRef, data) {
    mockTasks.push({ id: data.id || Date.now().toString(), ...data });
    notifyListeners();
}

export async function updateDoc(docRef, data) {
    const id = docRef.path.split('/').pop();
    const idx = mockTasks.findIndex(t => t.id === id);
    if (idx !== -1) {
        mockTasks[idx] = { ...mockTasks[idx], ...data };
        notifyListeners();
    }
}

export function onSnapshot(colRef, onNext, onError) {
    listeners.push(onNext);
    notifyListeners();
    return () => {
        listeners = listeners.filter(l => l !== onNext);
    };
}
