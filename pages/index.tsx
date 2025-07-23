import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { createClient, Session, User } from '@supabase/supabase-js';

// ===================== Supabase Client Setup =====================
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
// Fallback placeholder (won't function for real auth without real keys)
const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnon || 'public-anon-key-placeholder'
);

// ===================== Types =====================
interface Sutra {
  id: string;
  title: string;
  content: string[]; // paragraphs
}
interface Annotation {
  id: string;
  paragraphKey: string; // composite key sutraId:paragraphIndex
  userId: string;
  content: string;
  createdAt: string;
}

// ===================== Utility Helpers =====================
const storageAvailable = () => typeof window !== 'undefined' && !!window.localStorage;

function loadLocalJSON<T>(key: string, fallback: T): T {
  if (!storageAvailable()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function saveLocalJSON<T>(key: string, value: T) {
  if (!storageAvailable()) return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}
function randomId() {
  return Math.random().toString(36).slice(2, 11);
}

// Attempt Supabase upsert gracefully
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeUpsert(table: string, data: Record<string, any> | Record<string, any>[]) {
  try {
    // @ts-expect-error -- Supabase aPI can be generic
    const { error } = await supabase.from(table).upsert(data);
    if (error) throw error;
  } catch {
    // Table might not exist yet - ignore for demo
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function _safeSelect(table: string, match: Record<string, any>) {
  try {
    // @ts-expect-error -- Supabase API can be generic
    const { data, error } = await supabase.from(table).select('*').match(match);
    if (error) throw error;
    return data || [];
  } catch {
    return [];
  }
}

// ===================== Captcha Hook =====================
function useCaptcha() {
  const gen = () => ({ a: Math.floor(Math.random() * 10) + 1, b: Math.floor(Math.random() * 10) + 1 });
  
  // 1. 初始状态设为一个固定的、无害的值 (例如 null 或 0)
  const [pair, setPair] = useState({ a: 0, b: 0 }); 
  const [input, setInput] = useState('');
  const [valid, setValid] = useState(false);
  
  const refresh = () => { setPair(gen()); setInput(''); setValid(false); };
  
  // 2. 将随机数生成逻辑移入 useEffect，它只在客户端执行
  useEffect(() => {
    setPair(gen()); // 页面加载后，在客户端生成第一个随机数
  }, []); // 空数组保证这个 effect 只运行一次

  useEffect(() => {
    // 确保 pair 不是初始值 {0, 0} 时再计算
    if (pair.a !== 0) { 
      const ans = pair.a + pair.b;
      setValid(Number(input) === ans);
    }
  }, [input, pair]);

  return { pair, input, setInput, valid, refresh };
}

// ===================== Data Store Hook (Progress & Annotations) =====================
function useReadingData(user: User | null) {
  const userKey = user?.id || 'guest';
  const progressKey = `progress_${userKey}`;
  const annotationKey = `annotations_${userKey}`;
  const [progress, setProgress] = useState<Record<string, boolean>>({});
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setProgress(loadLocalJSON(progressKey, {}));
    setAnnotations(loadLocalJSON(annotationKey, []));
  }, [userKey, progressKey, annotationKey]);

  useEffect(() => { saveLocalJSON(progressKey, progress); }, [progressKey, progress]);
  useEffect(() => { saveLocalJSON(annotationKey, annotations); }, [annotationKey, annotations]);

  const markRead = useCallback(async (paragraphKey: string) => {
    setProgress(p => ({ ...p, [paragraphKey]: true }));
    if (user) {
      setSyncing(true);
      await safeUpsert('progress', { id: paragraphKey, user_id: user.id, read: true, updated_at: new Date().toISOString() });
      setSyncing(false);
    }
  }, [user]);

  const addAnnotation = useCallback(async (paragraphKey: string, content: string) => {
    if (!content.trim()) return;
    const ann: Annotation = {
      id: randomId(),
      paragraphKey,
      userId: user?.id || 'guest',
      content: content.trim(),
      createdAt: new Date().toISOString(),
    };
    setAnnotations(a => [...a, ann]);
    if (user) {
      setSyncing(true);
      await safeUpsert('annotations', {
        id: ann.id, paragraph_key: paragraphKey, user_id: user.id, content: ann.content, created_at: ann.createdAt,
      });
      setSyncing(false);
    }
  }, [user]);

  const annotationsFor = useCallback((paragraphKey: string) => annotations.filter(a => a.paragraphKey === paragraphKey), [annotations]);

  const importAll = (data: { progress: Record<string, boolean>; annotations: Annotation[] }) => {
    setProgress(data.progress || {});
    setAnnotations(data.annotations || []);
  };

  const exportAll = () => JSON.stringify({ progress, annotations }, null, 2);

  return { progress, markRead, addAnnotation, annotationsFor, syncing, importAll, exportAll };
}

// ===================== Scripture Generation / Loading Simulation =====================
function generateDemoSutras(startIndex: number, count: number): Sutra[] {
  const list: Sutra[] = [];
  for (let i = 0; i < count; i++) {
    const id = `sutra_${startIndex + i}`;
    const paraCount = 5 + Math.floor(Math.random() * 4);
    const content: string[] = [];
    for (let p = 0; p < paraCount; p++) {
      content.push(`第 ${p + 1} 段示例文字：这是演示用的阿含经段落内容（编号 ${startIndex + i}-${p + 1}），可通过导入真实 JSON 数据替换。`);
    }
    list.push({ id, title: `示例经文 ${startIndex + i}`, content });
  }
  return list;
}

// ===================== Main Page Component =====================
const HomePage: NextPage = () => {
  const router = useRouter();
  const [_session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authView, setAuthView] = useState<'login' | 'register'>('login');
  const [emailConfirmNeeded, setEmailConfirmNeeded] = useState(false);
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [humanGatePassed, setHumanGatePassed] = useState(false);

  // Password reset state
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const hashHandledRef = useRef(false);

  // Captcha
  const captcha = useCaptcha();
  const honeypotRef = useRef<HTMLInputElement | null>(null);

  // Scriptures
  const [sutras, setSutras] = useState<Sutra[]>(() => generateDemoSutras(1, 5));
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [importing, setImporting] = useState(false);

  // Reading data
  const { progress, markRead, addAnnotation, annotationsFor, syncing, importAll, exportAll } = useReadingData(user);

  // ---------------- Auth: Initialization & Hash Parsing ----------------
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user || null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setUser(sess?.user || null);
      if (sess?.user?.email_confirmed_at) {
        setEmailConfirmNeeded(false);
      }
    });

    return () => { listener.subscription.unsubscribe(); };
  }, []);

  // Hash token parsing for email confirm / recovery
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (hashHandledRef.current) return;
    const hash = window.location.hash;
    if (hash && hash.includes('access_token')) {
      const params = new URLSearchParams(hash.substring(1));
      const access_token = params.get('access_token');
      const refresh_token = params.get('refresh_token');
      const type = params.get('type');
      if (access_token && refresh_token) {
        supabase.auth.setSession({ access_token, refresh_token });
        if (type === 'recovery') {
          setRecoveryMode(true);
        }
        // Clean up hash
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
      }
      hashHandledRef.current = true;
    }
    const queryType = router.query.type;
    if (queryType === 'recovery') {
      setRecoveryMode(true);
    }
  }, [router.query]);

  // ---------------- Auth Actions ----------------
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setMessage(null);
    if (!captcha.valid) { setError('请先通过人类验证'); return; }
    if (honeypotRef.current?.value) { setError('机器人检测触发'); return; }
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    const email = (formData.get('email') as string || '').trim();
    const password = formData.get('password') as string;
    if (!email || !password) { setError('请输入邮箱与密码'); return; }
    setLoadingAuth(true);
    try {
      const { data, error: signError } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
      if (signError) throw signError;
      if (data.user && !data.session) {
        setEmailConfirmNeeded(true);
        setMessage('注册成功，确认邮件已发送，请前往邮箱验证。');
      } else if (data.session) {
        setMessage('注册成功');
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
	} catch (err: any) {
      setError(err.message || '注册失败');
    } finally {
      setLoadingAuth(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setMessage(null);
    if (!captcha.valid) { setError('请先通过人类验证'); return; }
    if (honeypotRef.current?.value) { setError('机器人检测触发'); return; }
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    const email = (formData.get('email') as string || '').trim();
    const password = formData.get('password') as string;
    if (!email || !password) { setError('请输入邮箱与密码'); return; }
    setLoadingAuth(true);
    try {
      const { data, error: signError } = await supabase.auth.signInWithPassword({ email, password });
      if (signError) throw signError;
      if (data.user && !data.user.email_confirmed_at) {
        setEmailConfirmNeeded(true);
        setMessage('请先完成邮箱验证');
      } else {
        setMessage('登录成功');
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
	} catch (err: any) {
      setError(err.message || '登录失败');
    } finally {
      setLoadingAuth(false);
    }
  };

  const handleCheckEmailConfirmed = async () => {
    setCheckingEmail(true);
    try {
      const { data } = await supabase.auth.getUser();
      if (data.user?.email_confirmed_at) {
        setEmailConfirmNeeded(false);
        setMessage('邮箱已验证，欢迎进入！');
      } else {
        setError('尚未验证，请稍后再试');
      }
    } finally {
      setCheckingEmail(false);
    }
  };

  const handleSendPasswordReset = async (email: string) => {
    setError(null); setMessage(null); setResetEmailSent(false);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
      if (resetError) throw resetError;
      setResetEmailSent(true);
      setMessage('重置邮件已发送，请检查邮箱。');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
	} catch (err: any) {
      setError(err.message || '发送失败');
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setMessage(null);
    if (!newPassword) { setError('请输入新密码'); return; }
    try {
      const { error: upErr } = await supabase.auth.updateUser({ password: newPassword });
      if (upErr) throw upErr;
      setMessage('密码已更新，正在跳转...');
      setTimeout(() => { setRecoveryMode(false); }, 1500);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
	} catch (err: any) {
      setError(err.message || '更新失败');
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setMessage('已退出');
  };

  // ---------------- Scripture Handling ----------------
  const handleLoadMore = () => {
    setLoadingMore(true);
    setTimeout(() => {
      setSutras(prev => [...prev, ...generateDemoSutras(prev.length + 1, 5)]);
      setLoadingMore(false);
    }, 700);
  };

  const filteredSutras = useMemo(() => {
    const term = search.trim();
    if (!term && !showUnreadOnly) return sutras;
    // Filter paragraphs inside each sutra
    return sutras.map(s => {
      const newContent = s.content.filter((para, idx) => {
        const paragraphKey = `${s.id}:${idx}`;
        const unreadCondition = showUnreadOnly ? !progress[paragraphKey] : true;
        const searchCondition = term ? (para.includes(term) || s.title.includes(term)) : true;
        return unreadCondition && searchCondition;
      });
      return { ...s, content: newContent };
    }).filter(s => s.content.length > 0);
  }, [sutras, search, showUnreadOnly, progress]);

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    setImporting(true);
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        if (Array.isArray(parsed)) {
          const validated: Sutra[] = parsed.filter(it => it && it.id && it.title && Array.isArray(it.content));
          setSutras(validated);
        }
      } catch {
        // ignore
      } finally {
        setImporting(false);
      }
    };
    reader.readAsText(file);
  };

  const handleMarkAllVisibleRead = () => {
    filteredSutras.forEach(s => {
      s.content.forEach((_, idx) => {
        const key = `${s.id}:${idx}`;
        if (!progress[key]) markRead(key);
      });
    });
  };

  const handleExportData = () => {
    const blob = new Blob([exportAll()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'reading_data.json'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportDataFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        importAll(parsed);
      } catch {
        // ignore invalid
      }
    };
    reader.readAsText(file);
  };

  // ---------------- UI Subcomponents ----------------
  const AuthSection = () => (
    <div className="max-w-md w-full mx-auto bg-white rounded-lg shadow p-6 border border-gray-200">
      <h2 className="text-xl font-semibold text-gray-800 mb-4 text-center">阿含经阅读平台</h2>
      <div className="flex justify-center mb-4 gap-4">
        <button onClick={() => { setAuthView('login'); setError(null); setMessage(null); }} className={`px-4 py-2 rounded font-medium ${authView === 'login' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}>登录</button>
        <button onClick={() => { setAuthView('register'); setError(null); setMessage(null); }} className={`px-4 py-2 rounded font-medium ${authView === 'register' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}>注册</button>
      </div>

      {!humanGatePassed && (
        <div className="mb-4 p-4 border border-yellow-300 bg-yellow-50 rounded">
          <p className="text-sm text-gray-700 mb-2 font-medium">人类验证：请输入 {captcha.pair.a} + {captcha.pair.b} 的结果</p>
          <div className="flex items-center gap-2 mb-2">
            <input type="number" className="w-24 px-2 py-1 border rounded" value={captcha.input} onChange={e => captcha.setInput(e.target.value)} />
            <button className="px-2 py-1 text-sm bg-gray-200 rounded" onClick={captcha.refresh}>换一题</button>
          </div>
          <button disabled={!captcha.valid} onClick={() => setHumanGatePassed(true)} className={`w-full py-2 rounded text-white font-medium ${captcha.valid ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-400 cursor-not-allowed'}`}>通过验证</button>
        </div>
      )}

      {humanGatePassed && !recoveryMode && (
        <form onSubmit={authView === 'login' ? handleLogin : handleRegister} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">邮箱</label>
            <input name="email" type="email" className="w-full border rounded px-3 py-2 focus:outline-none focus:ring focus:border-blue-400" placeholder="you@example.com" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">密码</label>
            <input name="password" type="password" className="w-full border rounded px-3 py-2 focus:outline-none focus:ring focus:border-blue-400" placeholder="•••••••" required />
          </div>
          <input ref={honeypotRef} name="nickname" className="hidden" tabIndex={-1} autoComplete="off" />
          <div className="flex items-center justify-between text-sm">
            {authView === 'login' && (
              <button type="button" className="text-blue-600 hover:underline" onClick={() => {
                const email = prompt('请输入注册邮箱以找回密码');
                if (email) handleSendPasswordReset(email.trim());
              }}>忘记密码?</button>
            )}
            {resetEmailSent && <span className="text-green-600">已发送重置邮件</span>}
          </div>
          <button disabled={loadingAuth} className={`w-full py-2 rounded text-white font-medium ${loadingAuth ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}>{authView === 'login' ? '登录' : '注册'}</button>
        </form>
      )}

      {recoveryMode && (
        <form onSubmit={handleUpdatePassword} className="space-y-4">
          <p className="text-sm text-gray-700">请输入新密码完成重置。</p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">新密码</label>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full border rounded px-3 py-2" required />
            </div>
            <button className="w-full py-2 bg-green-600 hover:bg-green-700 text-white rounded font-medium">更新密码</button>
        </form>
      )}

      {emailConfirmNeeded && !recoveryMode && (
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded">
          <p className="text-sm text-gray-700 mb-2">请前往邮箱点击确认链接，然后点击下方按钮刷新状态。</p>
          <button disabled={checkingEmail} onClick={handleCheckEmailConfirmed} className={`px-3 py-1 rounded text-white text-sm font-medium ${checkingEmail ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}>我已完成邮箱验证</button>
        </div>
      )}

      {error && <div className="mt-4 p-2 bg-red-100 text-red-700 text-sm rounded">{error}</div>}
      {message && <div className="mt-4 p-2 bg-green-100 text-green-700 text-sm rounded">{message}</div>}

      <div className="mt-6 text-xs text-gray-500 space-y-1">
        <p>若未配置环境变量（SUPABASE URL/KEY），认证将无法真正工作。</p>
        <p>请在 Supabase 后台开启邮箱确认 & 设置重定向 URL 为本站。</p>
      </div>
    </div>
  );

  interface ParagraphProps {
    sutraId: string;
    index: number;
    text: string;
  }

  const Paragraph: React.FC<ParagraphProps> = ({ sutraId, index, text }) => {
    const paragraphKey = `${sutraId}:${index}`;
    const read = !!progress[paragraphKey];
    const [inputValue, setInputValue] = useState('');
    const [showAnn, setShowAnn] = useState(false);
    const annotationList = annotationsFor(paragraphKey);

    return (
      <div className="border rounded p-3 bg-white shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <p className={`text-gray-800 text-sm leading-relaxed ${read ? 'opacity-80' : ''}`}>{text}</p>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              {!read && (
                <input
                  type="text"
                  className="px-2 py-1 border rounded text-xs focus:outline-none focus:ring w-24"
                  placeholder="输入over"
                  value={inputValue}
                  onChange={e => {
                    const v = e.target.value;
                    setInputValue(v);
                    if (v.trim().toLowerCase() === 'over') {
                      markRead(paragraphKey);
                    }
                  }}
                />
              )}
              {read && (
                <div className="flex items-center gap-1 text-green-600 text-sm font-medium">
                  <span className="inline-block w-4 h-4 rounded bg-green-600 text-white text-[10px] flex items-center justify-center">✓</span>
                  <span>已读</span>
                </div>
              )}
              <button onClick={() => setShowAnn(s => !s)} className="text-xs px-2 py-1 rounded border bg-gray-50 hover:bg-gray-100 text-gray-700">注释({annotationList.length})</button>
            </div>
          </div>
        </div>
        {showAnn && (
          <div className="mt-3 border-t pt-3">
            <AnnotationEditor paragraphKey={paragraphKey} addAnnotation={addAnnotation} list={annotationList} user={user} />
          </div>
        )}
      </div>
    );
  };

  interface AnnotationEditorProps {
    paragraphKey: string;
    addAnnotation: (k: string, content: string) => void;
    list: Annotation[];
    user: User | null;
  }

  const AnnotationEditor: React.FC<AnnotationEditorProps> = ({ paragraphKey, addAnnotation, list, user }) => {
    const [value, setValue] = useState('');
    return (
      <div className="space-y-2">
        <div className="flex gap-2 items-start">
          <textarea
            className="flex-1 border rounded px-2 py-1 text-sm focus:outline-none focus:ring"
            rows={2}
            placeholder={user ? '输入注释后保存' : '请先登录才能保存注释'}
            value={value}
            onChange={e => setValue(e.target.value)}
          />
          <button
            disabled={!value.trim() || !user}
            onClick={() => { addAnnotation(paragraphKey, value); setValue(''); }}
            className={`px-3 py-2 rounded text-white text-sm font-medium ${value.trim() && user ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-400 cursor-not-allowed'}`}
          >保存</button>
        </div>
        <div className="space-y-2 max-h-48 overflow-auto pr-1">
          {list.length === 0 && <p className="text-xs text-gray-500">暂无注释</p>}
          {list.map(a => (
            <div key={a.id} className="text-xs p-2 border rounded bg-gray-50">
              <div className="flex justify-between mb-1">
                <span className="font-medium text-gray-700">{a.userId === user?.id ? '我' : a.userId.slice(0, 6)}</span>
                <span className="text-gray-500">{new Date(a.createdAt).toLocaleString()}</span>
              </div>
              <p className="text-gray-700 whitespace-pre-wrap leading-snug">{a.content}</p>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const ScriptureList = () => (
    <div className="space-y-6">
      {filteredSutras.map(sutra => (
        <div key={sutra.id} className="border border-gray-200 rounded-lg bg-gray-50 p-4 shadow-sm">
          <h3 className="font-semibold text-gray-800 mb-3 flex items-center justify-between">
            <span>{sutra.title}</span>
            <span className="text-xs text-gray-500">段落数: {sutra.content.length}</span>
          </h3>
          <div className="grid gap-4">
            {sutra.content.map((p, idx) => (
              <Paragraph key={`${sutra.id}:${idx}`} sutraId={sutra.id} index={idx} text={p} />
            ))}
          </div>
        </div>
      ))}
      {filteredSutras.length === 0 && (
        <div className="p-6 text-center text-sm text-gray-500 bg-white rounded border">没有匹配的段落</div>
      )}
    </div>
  );

  // ---------------- Main Render ----------------
  const authedAndConfirmed = !!user && !emailConfirmNeeded && !recoveryMode;

  return (
    <div className="min-h-screen bg-gray-100 text-gray-800">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-8">
        {!authedAndConfirmed && <AuthSection />}
        {authedAndConfirmed && (
          <div className="space-y-8">
            <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-2">
                <h1 className="text-2xl font-bold text-gray-800">阿含经阅读平台</h1>
                <p className="text-sm text-gray-600">支持阅读进度、注释、搜索与导入。大规模经文请部署在后端并通过接口分页加载。</p>
                <div className="text-xs text-gray-500">{!supabaseUrl && '未检测到有效 SUPABASE 环境变量，当前为本地演示数据。'}</div>
              </div>
              <div className="flex flex-col gap-3 md:items-end">
                <div className="flex flex-wrap gap-2">
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索标题或内容" className="px-3 py-2 border rounded w-56 text-sm focus:outline-none focus:ring" />
                  <button onClick={() => setShowUnreadOnly(s => !s)} className={`px-3 py-2 rounded text-sm font-medium border ${showUnreadOnly ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>{showUnreadOnly ? '显示全部' : '仅未读'}</button>
                  <button onClick={handleMarkAllVisibleRead} className="px-3 py-2 rounded text-sm font-medium border bg-white hover:bg-gray-50 text-gray-700">当前结果全部标记已读</button>
                  <div className="relative">
                    <label className="px-3 py-2 rounded text-sm font-medium border bg-white hover:bg-gray-50 text-gray-700 cursor-pointer">导入经文JSON<input type="file" accept="application/json" onChange={handleImportJSON} className="hidden" /></label>
                  </div>
                  <div className="relative">
                    <label className="px-3 py-2 rounded text-sm font-medium border bg-white hover:bg-gray-50 text-gray-700 cursor-pointer">导入进度<input type="file" accept="application/json" onChange={handleImportDataFile} className="hidden" /></label>
                  </div>
                  <button onClick={handleExportData} className="px-3 py-2 rounded text-sm font-medium border bg-white hover:bg-gray-50 text-gray-700">导出进度</button>
                  <button onClick={handleLogout} className="px-3 py-2 rounded text-sm font-medium bg-red-600 text-white hover:bg-red-700">退出</button>
                </div>
                <div className="text-xs text-gray-500">当前用户：{user?.email} {syncing && <span className="text-blue-600 ml-1">同步中...</span>}</div>
              </div>
            </header>

            <div className="bg-white p-4 rounded border shadow-sm space-y-2">
              <h2 className="font-semibold text-gray-700">数据导入说明</h2>
              <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                <li>经文 JSON 格式示例：[{`{"id":"sutra_1","title":"某经","content":["段1","段2"]}`}]</li>
                <li>读取进度与注释导出后可备份再导入。</li>
                <li>真实部署时请在后端创建表：sutras / progress / annotations，并通过分页接口加载。</li>
                <li>输入 over 标记已读，避免误操作。</li>
              </ul>
              {importing && <div className="text-xs text-blue-600">正在导入经文数据...</div>}
            </div>

            <ScriptureList />

            <div className="flex justify-center pt-4">
              <button disabled={loadingMore} onClick={handleLoadMore} className={`px-6 py-2 rounded font-medium text-white ${loadingMore ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}>{loadingMore ? '加载中...' : '加载更多'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default HomePage;
