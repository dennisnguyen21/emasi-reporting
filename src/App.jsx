import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import {
    getFirestore,
    collection,
    doc,
    setDoc,
    updateDoc,
    onSnapshot,
    enableIndexedDbPersistence
} from 'firebase/firestore';
import {
    getAuth,
    signInAnonymously,
    signInWithCustomToken,
    onAuthStateChanged
} from 'firebase/auth';
import {
    UserCircle2,
    CheckCircle2,
    Clock,
    AlertCircle,
    Calendar,
    Layers,
    Activity,
    CalendarDays,
    Lock,
    Unlock,
    Sparkles,
    ChevronDown
} from 'lucide-react';

// --- KHỞI TẠO FIREBASE ---
const firebaseConfig = {
    apiKey: "AIzaSyDZ5mdC-vN1htusotzyfS4bFIkxzGmbywE",
    authDomain: "emasi-reporting-hub.firebaseapp.com",
    projectId: "emasi-reporting-hub",
    storageBucket: "emasi-reporting-hub.firebasestorage.app",
    messagingSenderId: "899744144586",
    appId: "1:899744144586:web:16c51b955895ede0a02833",
    measurementId: "G-4SSY727EGR"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Enable offline persistence for faster initial loads
enableIndexedDbPersistence(db).catch((err) => {
    if (err.code == 'failed-precondition') {
        console.warn("Multiple tabs open, persistence can only be enabled in one tab at a a time.");
    } else if (err.code == 'unimplemented') {
        console.warn("The current browser does not support all of the features required to enable persistence.");
    }
});

// SỬA LỖI QUAN TRỌNG: appId phải là một chuỗi không chứa dấu "/" để Firestore 
// coi nó là 1 segment duy nhất trong đường dẫn /artifacts/{appId}/...
const appId = firebaseConfig.projectId.replace(/\//g, '_');

const STATUS_CONFIG = {
    "Not Started": {
        color: "bg-slate-50 text-slate-400 border-slate-200",
        icon: Clock,
        accent: "bg-slate-300"
    },
    "In Progress": {
        color: "bg-indigo-50 text-indigo-700 border-indigo-200 shadow-indigo-100",
        icon: Activity,
        accent: "bg-indigo-500"
    },
    "Completed": {
        color: "bg-emerald-50 text-emerald-700 border-emerald-200 shadow-emerald-100",
        icon: CheckCircle2,
        accent: "bg-emerald-500"
    },
    "Overdue": {
        color: "bg-rose-50 text-rose-700 border-rose-200 shadow-rose-100",
        icon: AlertCircle,
        accent: "bg-rose-500"
    }
};

const STATUS_OPTIONS = Object.keys(STATUS_CONFIG);

const formatDateToDisplay = (dateStr) => {
    if (!dateStr) return "";
    const str = String(dateStr);
    if (!str.includes('-')) return str;
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
};

const INITIAL_TASK_TEMPLATE = [
    { id: '1', step: 1, description: 'Subject & Homeroom teachers enter grades in Gradebooks', earlyYears: '', primary: '', secondary: '', status: 'Not Started' },
    { id: '2', step: 2, description: 'Subject teachers finish report wizard comments & set status', earlyYears: '', primary: '', secondary: '', status: 'Not Started' },
    { id: '3', step: 3, description: 'Tutors review, flag errors, and assign attitude grades (MOET subjects)', earlyYears: '', primary: '', secondary: '', status: 'Not Started' },
    { id: '4', step: 4, description: 'HOS review (IP subjects)', earlyYears: '', primary: '', secondary: '', status: 'Not Started' },
    { id: '5', step: 5, description: 'HOD review & flag transfer (both IP & MOET subjects)', earlyYears: '', primary: '', secondary: '', status: 'Not Started' },
    { id: '6', step: 6, description: 'Managing Director performs final quality check', earlyYears: '', primary: '', secondary: '', status: 'Not Started' },
    { id: '7', step: 7, description: 'Academic Officers export & verify PDF reports', earlyYears: '', primary: '', secondary: '', status: 'Not Started' },
    { id: '8', step: 8, description: 'Close reporting cycle', earlyYears: '', primary: '', secondary: '', status: 'Not Started' }
];

export default function App() {
    const [user, setUser] = useState(null);
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);

    const [identities, setIdentities] = useState({
        earlyYears: localStorage.getItem('emasi_user_earlyYears') || '',
        primary: localStorage.getItem('emasi_user_primary') || '',
        secondary: localStorage.getItem('emasi_user_secondary') || ''
    });

    const [showIdentityModal, setShowIdentityModal] = useState(false);
    const [targetCol, setTargetCol] = useState(null);
    const [tempName, setTempName] = useState('');
    const [pendingAction, setPendingAction] = useState(null);
    const [editingCell, setEditingCell] = useState(null);

    // MẪU BẮT BUỘC: Đăng nhập trước khi truy vấn
    useEffect(() => {
        const initAuth = async () => {
            try {
                if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                    await signInWithCustomToken(auth, __initial_auth_token);
                } else {
                    await signInAnonymously(auth);
                }
            } catch (err) {
                console.error("Lỗi xác thực:", err);
            }
        };
        initAuth();
        const unsubscribe = onAuthStateChanged(auth, (u) => {
            setUser(u);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    // ĐỒNG BỘ DỮ LIỆU: Chỉ chạy khi có user
    useEffect(() => {
        if (!user) return;

        // Đường dẫn chuẩn: artifacts (1) -> appId (2) -> public (3) -> data (4) -> tasks (5)
        const tasksCol = collection(db, 'artifacts', appId, 'public', 'data', 'tasks');

        const unsubTasks = onSnapshot(tasksCol,
            async (snap) => {
                const data = snap.docs.map(d => {
                    const r = d.data();
                    return {
                        id: d.id,
                        step: r.step || 0,
                        description: String(r.description || ""),
                        earlyYears: String(r.earlyYears || ""),
                        primary: String(r.primary || ""),
                        secondary: String(r.secondary || ""),
                        status: String(r.status || "Not Started")
                    };
                });

                if (data.length === 0) {
                    // Nếu chưa có dữ liệu, KHÔNG map over mảng array trực tiếp với setDoc 
                    // mà chỉ khởi tạo State ảo, Firestore setup sẽ chạy ngầm
                    setTasks(INITIAL_TASK_TEMPLATE);
                    for (const t of INITIAL_TASK_TEMPLATE) {
                        const tDoc = doc(db, 'artifacts', appId, 'public', 'data', 'tasks', t.id);
                        await setDoc(tDoc, t);
                    }
                } else {
                    setTasks(data.sort((a, b) => a.step - b.step));
                }
            },
            (err) => {
                console.error("Lỗi Firestore:", err.message);
                setLoading(false);
            }
        );

        return () => unsubTasks();
    }, [user]);

    const updateTaskStatus = async (taskId, nextStatus) => {
        if (!user) return;
        try {
            const taskRef = doc(db, 'artifacts', appId, 'public', 'data', 'tasks', taskId);
            await updateDoc(taskRef, { status: String(nextStatus) });
        } catch (err) { console.error("Cập nhật thất bại:", err); }
    };

    const updateTaskField = async (taskId, field, newValue, oldValue) => {
        if (!user) return;
        const val = String(newValue);
        if (val === String(oldValue || "")) {
            setEditingCell(null);
            return;
        }

        if (!identities[field]) {
            setPendingAction({ taskId, field, newValue: val, oldValue: String(oldValue) });
            setTargetCol(field);
            setTempName('');
            setShowIdentityModal(true);
            return;
        }

        try {
            const taskRef = doc(db, 'artifacts', appId, 'public', 'data', 'tasks', taskId);
            await updateDoc(taskRef, { [field]: val });
            setEditingCell(null);
        } catch (err) { console.error("Cập nhật thất bại:", err); }
    };

    const confirmIdentity = (e) => {
        e.preventDefault();
        if (tempName.trim() && targetCol) {
            const newIdentities = { ...identities, [targetCol]: tempName };
            setIdentities(newIdentities);
            localStorage.setItem(`emasi_user_${targetCol}`, tempName);
            setShowIdentityModal(false);

            if (pendingAction) {
                const taskRef = doc(db, 'artifacts', appId, 'public', 'data', 'tasks', pendingAction.taskId);
                updateDoc(taskRef, { [pendingAction.field]: String(pendingAction.newValue) });
                setPendingAction(null);
                setEditingCell(null);
            }
        }
    };

    const progressStats = useMemo(() => {
        const total = tasks.length || 1;
        const completed = tasks.filter(t => t.status === 'Completed').length;
        return Math.round((completed / total) * 100);
    }, [tasks]);

    const handleDatePickerChange = (e, task, field) => {
        const rawDate = e.target.value;
        if (!rawDate) return;
        const formatted = formatDateToDisplay(rawDate);
        updateTaskField(task.id, field, formatted, task[field]);
    };

    const renderEditableCell = (task, field) => {
        const isEditing = editingCell?.taskId === task.id && editingCell?.field === field;
        const value = String(task[field] || "");
        const isDefault = !value;

        return (
            <div className="relative group/cell flex items-center justify-center w-full min-h-[44px]">
                {isEditing ? (
                    <div className="flex items-center gap-1 w-full animate-in fade-in zoom-in duration-300">
                        <input
                            type="text"
                            className="flex-1 text-[11px] font-bold text-slate-800 bg-white border border-indigo-400 rounded-xl px-2 py-2 focus:outline-none shadow-sm"
                            value={editingCell.value}
                            autoFocus
                            onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                            onBlur={(e) => {
                                if (e.relatedTarget?.getAttribute('data-type') === 'picker-trigger') return;
                                updateTaskField(task.id, field, editingCell.value, value);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') updateTaskField(task.id, field, editingCell.value, value);
                                if (e.key === 'Escape') setEditingCell(null);
                            }}
                            placeholder="DD/MM/YYYY"
                        />

                        <div className="relative flex items-center">
                            <input
                                type="date"
                                className="absolute inset-0 opacity-0 cursor-pointer w-7 h-7 z-10"
                                data-type="picker-trigger"
                                onChange={(e) => handleDatePickerChange(e, task, field)}
                            />
                            <button className="p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all shadow-md active:scale-95">
                                <CalendarDays className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                ) : (
                    <button
                        onClick={() => setEditingCell({ taskId: task.id, field, value: value })}
                        className={`flex items-center gap-2 text-[11px] font-bold transition-all w-full text-left px-2 py-2.5 rounded-xl border border-transparent hover:border-indigo-100 hover:bg-white hover:shadow-lg hover:shadow-indigo-50/50 group-hover/cell:scale-105 active:scale-95 ${isDefault ? 'text-slate-300' : 'text-indigo-600'}`}
                    >
                        <Calendar className={`w-3.5 h-3.5 transition-all duration-500 ${isDefault ? 'opacity-20' : 'text-indigo-500 opacity-60'}`} />
                        <span className="tracking-tight">{isDefault ? "DD/MM/YYYY" : value}</span>
                    </button>
                )}
            </div>
        );
    };

    const getColLabel = (key) => {
        if (!key) return '';
        const s = String(key);
        if (s === 'earlyYears') return 'Early Years';
        return s.charAt(0).toUpperCase() + s.slice(1);
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Activity className="w-8 h-8 text-indigo-600 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#F9FAFB] text-slate-900 flex flex-col font-sans selection:bg-indigo-100 selection:text-indigo-900 overflow-x-hidden">
            <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
                <div className="absolute top-[-10%] left-[-5%] w-[45%] h-[45%] bg-indigo-100/40 rounded-full blur-[100px] animate-pulse"></div>
                <div className="absolute bottom-[10%] right-[-5%] w-[40%] h-[40%] bg-blue-100/30 rounded-full blur-[120px]"></div>
            </div>

            <nav className="bg-white/80 backdrop-blur-xl border-b border-slate-200/60 sticky top-0 z-40 shadow-sm">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-4 group cursor-pointer">
                        <div className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200 group-hover:rotate-6 group-hover:scale-110 transition-all duration-300">
                            <Layers className="text-white w-5 h-5" />
                        </div>
                        <div>
                            <h1 className="text-lg font-black tracking-tight text-slate-900 leading-none">EMASI Hub</h1>
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-0.5 flex items-center gap-1">
                                Academic Schools Hub <span className="text-indigo-600">•</span> 2026
                            </p>
                        </div>
                    </div>

                    <div className="hidden md:flex items-center gap-3">
                        {['earlyYears', 'primary', 'secondary'].map(col => (
                            <div key={col} className={`flex items-center gap-2.5 px-3.5 py-1.5 rounded-2xl transition-all duration-500 hover:translate-y-[-2px] ${identities[col] ? 'bg-emerald-50 border border-emerald-100 shadow-sm' : 'bg-slate-100/50 border border-slate-200 opacity-60'}`}>
                                <div className={`w-2 h-2 rounded-full ${identities[col] ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-slate-300'}`}></div>
                                <span className="text-[10px] font-black text-slate-600 uppercase tracking-tighter">{getColLabel(col)}</span>
                                {identities[col] ? <Unlock className="w-3 h-3 text-emerald-500" /> : <Lock className="w-3 h-3 text-slate-400" />}
                            </div>
                        ))}
                    </div>
                </div>
            </nav>

            <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8 relative z-10">
                <div className="space-y-6 animate-in fade-in duration-700">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-amber-500 fill-amber-500" />
                                <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Live Coordination Hub</span>
                            </div>
                            <h2 className="text-4xl font-black text-slate-900 tracking-tight leading-none">
                                Academic <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-indigo-400">Reporting Cycle</span>
                            </h2>
                        </div>

                        <div className="flex gap-4">
                            <div className="bg-white/60 backdrop-blur-md px-6 py-4 rounded-3xl border border-white shadow-xl shadow-slate-200/40 flex items-center gap-5 hover:translate-y-[-4px] transition-transform duration-300">
                                <div className="relative w-12 h-12">
                                    <svg className="w-12 h-12 transform -rotate-90">
                                        <circle cx="24" cy="24" r="21" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-slate-100" />
                                        <circle cx="24" cy="24" r="21" stroke="currentColor" strokeWidth="4" fill="transparent"
                                            strokeDasharray={132}
                                            strokeDashoffset={132 - (132 * progressStats) / 100}
                                            className="text-indigo-600 transition-all duration-1000" />
                                    </svg>
                                    <span className="absolute inset-0 flex items-center justify-center text-[10px] font-black">{progressStats}%</span>
                                </div>
                                <div>
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Global Process</p>
                                    <p className="text-sm font-black text-slate-800 tracking-tight">{tasks.filter(t => t.status === 'Completed').length} / {tasks.length} Done</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white/80 backdrop-blur-lg rounded-[2.5rem] border border-white shadow-2xl shadow-indigo-100/50 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left table-fixed min-w-[900px]">
                                <thead>
                                    <tr className="bg-indigo-50/40">
                                        <th className="px-6 py-6 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] text-center w-16">ID</th>
                                        <th className="px-6 py-6 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Workflow Process Description</th>
                                        <th className="px-2 py-6 text-[10px] font-black text-indigo-600 uppercase tracking-[0.2em] w-36 text-center">Early Years</th>
                                        <th className="px-2 py-6 text-[10px] font-black text-indigo-600 uppercase tracking-[0.2em] w-36 text-center">Primary</th>
                                        <th className="px-2 py-6 text-[10px] font-black text-indigo-600 uppercase tracking-[0.2em] w-36 text-center">Secondary</th>
                                        <th className="px-6 py-6 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] text-center w-48">Status (Admin)</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {tasks.map((task) => {
                                        const statusKey = String(task.status || "Not Started");
                                        const statusStyle = STATUS_CONFIG[statusKey] || STATUS_CONFIG["Not Started"];
                                        const StatusIcon = statusStyle.icon;
                                        return (
                                            <tr key={task.id} className="hover:bg-indigo-50/20 transition-all duration-300 group">
                                                <td className="px-6 py-5 text-center">
                                                    <span className="text-xs font-black text-slate-200 group-hover:text-indigo-600 transition-colors">
                                                        {String(task.step).padStart(2, '0')}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-5">
                                                    <h4 className="text-[13px] font-bold text-slate-700 leading-snug group-hover:text-slate-900 transition-colors">{String(task.description)}</h4>
                                                </td>
                                                <td className="px-2 py-5 text-center">
                                                    {renderEditableCell(task, 'earlyYears')}
                                                </td>
                                                <td className="px-2 py-5 text-center">
                                                    {renderEditableCell(task, 'primary')}
                                                </td>
                                                <td className="px-2 py-5 text-center">
                                                    {renderEditableCell(task, 'secondary')}
                                                </td>
                                                <td className="px-6 py-5">
                                                    <div className="relative group/status w-full">
                                                        <div className={`flex items-center gap-2 px-3 py-2.5 rounded-2xl border-2 transition-all duration-300 shadow-sm hover:shadow-md hover:scale-[1.02] ${statusStyle.color}`}>
                                                            <div className={`w-1.5 h-1.5 rounded-full ${statusStyle.accent} animate-pulse shrink-0 shadow-[0_0_8px] shadow-current`}></div>
                                                            <StatusIcon className="w-3.5 h-3.5 opacity-60 shrink-0" />
                                                            <select
                                                                value={statusKey}
                                                                onChange={(e) => updateTaskStatus(task.id, e.target.value)}
                                                                className="bg-transparent text-[10px] font-black uppercase tracking-widest outline-none cursor-pointer w-full appearance-none pr-4"
                                                            >
                                                                {STATUS_OPTIONS.map(opt => <option key={opt} value={opt} className="bg-white text-slate-900">{opt}</option>)}
                                                            </select>
                                                            <ChevronDown className="w-3.5 h-3.5 absolute right-3 opacity-30 group-hover/status:translate-y-0.5 transition-transform" />
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </main>

            {showIdentityModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 backdrop-blur-xl bg-slate-900/40 animate-in fade-in duration-500">
                    <div className="bg-white/90 backdrop-blur-2xl rounded-[3rem] shadow-2xl max-w-md w-full p-10 relative overflow-hidden border border-white animate-in zoom-in duration-300">
                        <div className="relative">
                            <div className="w-16 h-16 bg-gradient-to-br from-indigo-600 to-indigo-700 rounded-2xl flex items-center justify-center mb-8 shadow-xl shadow-indigo-100">
                                <UserCircle2 className="text-white w-8 h-8" />
                            </div>
                            <h3 className="text-2xl font-black text-slate-900 mb-3 tracking-tight">Authorize <span className="text-indigo-600">{getColLabel(targetCol)}</span> Access</h3>
                            <p className="text-slate-500 text-sm font-medium leading-relaxed mb-8">Each department requires a distinct identity. Once authorized, you can manage the <strong>{getColLabel(targetCol)}</strong> schedule freely.</p>
                            <form onSubmit={confirmIdentity} className="space-y-6">
                                <div>
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 px-1">Full Name / Role</label>
                                    <input type="text" value={tempName} onChange={(e) => setTempName(e.target.value)} placeholder="e.g. Ms. Lan - EY Coordinator" className="w-full px-6 py-4.5 rounded-2xl bg-white border-2 border-slate-100 focus:bg-white focus:ring-8 focus:ring-indigo-50/50 focus:border-indigo-600 outline-none transition-all text-slate-900 font-bold" autoFocus required />
                                </div>
                                <div className="flex gap-4">
                                    <button type="submit" className="flex-1 bg-indigo-600 text-white py-4.5 rounded-2xl font-black text-sm active:scale-95 transition-all shadow-xl shadow-indigo-100 hover:bg-indigo-700">Grant Access</button>
                                    <button type="button" onClick={() => { setShowIdentityModal(false); setPendingAction(null); }} className="px-6 bg-slate-50 text-slate-400 py-4.5 rounded-2xl font-bold text-sm">Back</button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            <footer className="py-12 bg-white/40 border-t border-slate-100 mt-auto text-center">
                <div className="flex items-center justify-center gap-2 mb-2 opacity-30">
                    <div className="w-8 h-[1px] bg-slate-400"></div>
                    <span className="text-[10px] font-black uppercase tracking-[0.4em]">EMASI Schools</span>
                    <div className="w-8 h-[1px] bg-slate-400"></div>
                </div>
                <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Academic Coordination Hub • Powered by IT</p>
            </footer>
        </div>
    );
}