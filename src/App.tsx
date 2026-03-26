import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Mic, MicOff, Bell, Users, Plus, Settings, X, Volume2 } from 'lucide-react';
import Peer from 'simple-peer';

interface User {
  username: string;
  isConnectedToVoice: boolean;
  socketId?: string;
}

// CONFIGURACIÓN DEL SERVIDOR
const SERVER_URL = 'https://war-chat.onrender.com';

// @ts-ignore
const electron = window.electronAPI;

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [username, setUsername] = useState(() => localStorage.getItem('war_username') || `Amigo_${Math.floor(Math.random() * 1000)}`);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(username);
  
  const [users, setUsers] = useState<User[]>([]);
  const [friends, setFriends] = useState<string[]>(() => {
    const saved = localStorage.getItem('war_friends');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [friendNameInput, setFriendNameInput] = useState('');
  
  // Connection Tracking
  const [connectionStatuses, setConnectionStatuses] = useState<Record<string, string>>({});

  // Audio Settings
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState(localStorage.getItem('war_mic') || 'default');
  const [selectedSpeaker, setSelectedSpeaker] = useState(localStorage.getItem('war_speaker') || 'default');
  const [showSettings, setShowSettings] = useState(false);
  const [myVolume, setMyVolume] = useState(0);
  const [isTestingAudio, setIsTestingAudio] = useState(false);

  const [inVoice, setInVoice] = useState(false);
  
  const userStream = useRef<MediaStream | null>(null);
  const testStream = useRef<MediaStream | null>(null);
  const testAudioRef = useRef<HTMLAudioElement | null>(null);
  const peersRef = useRef<any[]>([]);
  const audioContext = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);

  useEffect(() => {
    localStorage.setItem('war_username', username);
    localStorage.setItem('war_friends', JSON.stringify(friends));
    localStorage.setItem('war_mic', selectedMic);
    localStorage.setItem('war_speaker', selectedSpeaker);
  }, [username, friends, selectedMic, selectedSpeaker]);

  // SOCKET INITIALIZATION (Once)
  useEffect(() => {
    const loadDevices = async () => {
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        setDevices(devs);
      } catch (err) {
        console.error('Error listing devices', err);
      }
    };
    loadDevices();

    const s = io(SERVER_URL, {
      transports: ['polling', 'websocket'], // Allow polling for easier wake-up on Render
      reconnection: true,
      reconnectionAttempts: 20
    });
    setSocket(s);

    s.on('connect', () => {
      console.log('[Socket] Conectado exitosamente al servidor:', SERVER_URL);
      setIsSocketConnected(true);
    });

    s.on('connect_error', (err) => {
      console.error('[Socket] Error de conexión:', err.message);
      setIsSocketConnected(false);
      // Probablemente el servidor de Render está "durmiendo", reintentando...
    });

    s.on('user-list', (list: User[]) => {
      setUsers(list);
    });

    s.on('friend-notif', (data: { title: string; body: string }) => {
      if (electron) {
        electron.sendNotification(data.title, data.body);
      }
    });

    return () => {
      s.disconnect();
    };
  }, []);

  // JOIN ON RECONNECT / NAME CHANGE
  useEffect(() => {
    if (socket) {
      socket.emit('join', username);
    }
  }, [socket, username]);

  // SIGNALING HANDLER (Voice state dependent)
  useEffect(() => {
    if (!socket || !inVoice) return;

    const signalHandler = (data: { from: string, signal: any }) => {
      console.log(`[Signaling] Recibido ${data.signal.type || 'candidate'} de ${data.from}`);
      
      const peerData = peersRef.current.find(p => p.peerID === data.from);

      if (data.signal.type === 'offer' && peerData) {
        console.log(`[WebRTC] Conflicto de oferta con ${data.from}. Reiniciando peer.`);
        peerData.peer.destroy();
        peersRef.current = peersRef.current.filter(p => p.peerID !== data.from);
        const peer = createPeer(data.from, socket, userStream.current!, false);
        peer.signal(data.signal);
        return;
      }

      if (peerData) {
        peerData.peer.signal(data.signal);
      } else if (data.signal.type === 'offer') {
        console.log(`[WebRTC] Creando peer como respondedor para ${data.from}`);
        const peer = createPeer(data.from, socket, userStream.current!, false);
        peer.signal(data.signal);
      }
    };

    socket.on('signal', signalHandler);
    return () => {
      socket.off('signal', signalHandler);
    };
  }, [socket, inVoice, selectedSpeaker]);

  const createPeer = (userToSignal: string, socket: Socket, stream: MediaStream, initiator: boolean) => {
    setConnectionStatuses(prev => ({ ...prev, [userToSignal]: 'Conectando...' }));

    const peer = new Peer({
      initiator,
      trickle: true, // ENABLE TRICKLE ICE
      stream,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
          // Servidores TURN gratuitos de OpenRelayProject para saltar cortafuegos
          {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          },
          {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          },
          {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          }
        ],
        iceCandidatePoolSize: 10,
      },
    });

    peer.on('signal', (signal: any) => {
      console.log(`[ICE] Enviando ${signal.type || 'candidate'} a ${userToSignal}`);
      socket.emit('signal', { to: userToSignal, signal });
    });

    peer.on('connect', () => {
      console.log(`Connected with ${userToSignal}`);
      setConnectionStatuses(prev => ({ ...prev, [userToSignal]: 'Conectado ✅' }));
    });

    peer.on('stream', async (remoteStream: MediaStream) => {
      console.log(`[WebRTC] Recibido stream de ${userToSignal}. Tracks:`, remoteStream.getTracks().length);
      
      const audio = document.createElement('audio');
      audio.srcObject = remoteStream;
      audio.autoplay = true;
      audio.muted = true; // Hack para asegurar que inicie
      // @ts-ignore
      audio.playsInline = true;
      
      // @ts-ignore
      if (selectedSpeaker !== 'default' && audio.setSinkId) {
        try {
          // @ts-ignore
          await audio.setSinkId(selectedSpeaker);
        } catch (err) {
          console.error('Error setting sinkId', err);
        }
      }

      try {
        await audio.play();
        audio.muted = false; // Desbloquear audio tras iniciar
        console.log(`[Audio] Reproduciendo sonido de ${userToSignal}`);
      } catch (err) {
        console.error('[Audio] Error de reproducción (bloqueado por sistema):', err);
      }
      
      document.body.appendChild(audio);
      audio.style.display = 'none';
    });

    peer.on('close', () => {
      console.log(`Peer connection with ${userToSignal} closed`);
      setConnectionStatuses(prev => ({ ...prev, [userToSignal]: 'Desconectado' }));
    });

    peer.on('error', (err) => {
      console.error(`Peer error with ${userToSignal}:`, err);
      setConnectionStatuses(prev => ({ ...prev, [userToSignal]: 'Error ❌' }));
    });

    peersRef.current.push({
      peerID: userToSignal,
      peer,
    });
    
    return peer;
  };

  const startVolumeMeter = (stream: MediaStream) => {
    audioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    const analyserNode = audioContext.current.createAnalyser();
    analyser.current = analyserNode;
    const source = audioContext.current.createMediaStreamSource(stream);
    source.connect(analyserNode);
    analyserNode.fftSize = 256;
    
    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const checkVolume = () => {
      if (!analyser.current) return;
      analyser.current.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      setMyVolume(average);
      if (inVoice) requestAnimationFrame(checkVolume);
    };
    checkVolume();
  };

  const toggleVoice = async () => {
    if (!inVoice) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: { deviceId: selectedMic !== 'default' ? { exact: selectedMic } : undefined } 
        });
        userStream.current = stream;
        startVolumeMeter(stream);
        setInVoice(true);
        socket?.emit('set-voice-status', true);
        
        users.forEach(user => {
          if (user.isConnectedToVoice && user.username !== username && user.socketId) {
            // Initiate connection as initiator
            createPeer(user.socketId, socket!, stream, true);
          }
        });
      } catch (err) {
        console.error('Failed to get mic access', err);
        alert('No se pudo acceder al micrófono. Por favor revisa los permisos.');
      }
    } else {
      userStream.current?.getTracks().forEach(track => track.stop());
      peersRef.current.forEach(p => p.peer.destroy());
      peersRef.current = [];
      setInVoice(false);
      setMyVolume(0);
      socket?.emit('set-voice-status', false);
      audioContext.current?.close();
      // Remove temporary audio elements
      document.querySelectorAll('audio').forEach(el => el.remove());
    }
  };

  const notifyFriends = () => {
    if (socket) {
      socket.emit('notify-friends', username);
    }
  };

  const addFriend = () => {
    if (friendNameInput && !friends.includes(friendNameInput)) {
      setFriends([...friends, friendNameInput]);
      setFriendNameInput('');
      setShowAddFriend(false);
    }
  };

  const removeFriend = (name: string) => {
    setFriends(friends.filter(f => f !== name));
  };

  const saveProfile = () => {
    if (newName && newName !== username) {
      setUsername(newName);
      socket?.emit('join', newName); 
    }
    setEditingName(false);
  };

  const toggleAudioTest = async () => {
    if (!isTestingAudio) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: { deviceId: selectedMic !== 'default' ? { exact: selectedMic } : undefined } 
        });
        testStream.current = stream;
        
        if (!testAudioRef.current) {
          testAudioRef.current = document.createElement('audio');
          document.body.appendChild(testAudioRef.current);
          testAudioRef.current.style.display = 'none';
        }
        
        testAudioRef.current.srcObject = stream;
        // @ts-ignore
        if (selectedSpeaker !== 'default' && testAudioRef.current.setSinkId) {
          // @ts-ignore
          await testAudioRef.current.setSinkId(selectedSpeaker);
        }
        
        await testAudioRef.current.play();
        setIsTestingAudio(true);
      } catch (err) {
        console.error('Error testing audio', err);
        alert('Error al probar audio. Revisa tus dispositivos.');
      }
    } else {
      testStream.current?.getTracks().forEach(t => t.stop());
      if (testAudioRef.current) {
        testAudioRef.current.srcObject = null;
        testAudioRef.current.pause();
      }
      setIsTestingAudio(false);
    }
  };

  const isUserOnline = (name: string) => users.some(u => u.username === name);
  const getUserVoiceStatus = (name: string) => users.find(u => u.username === name)?.isConnectedToVoice;

  return (
    <div className="app-container">
      <div className="title-bar"></div>
      
      <aside className="sidebar">
        <div className="sidebar-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Users size={20} color="#6366f1" />
            <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>Amigos</h2>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="icon-btn" onClick={() => setShowSettings(true)}>
              <Settings size={18} />
            </button>
            <button className="icon-btn" onClick={() => setShowAddFriend(true)}>
              <Plus size={18} />
            </button>
          </div>
        </div>
        
        <div className="user-list">
          {friends.map((friend, i) => {
            const online = isUserOnline(friend);
            const inCall = getUserVoiceStatus(friend);
            return (
              <div key={i} className={`user-item ${inCall ? 'voice-active' : ''}`}>
                <div className={`avatar ${!online ? 'offline' : ''}`}>{friend[0].toUpperCase()}</div>
                <div className="user-info">
                  <div className="user-name">{friend}</div>
                  <div className="user-status">
                    {inCall ? (connectionStatuses[users.find(u => u.username === friend)?.socketId || ''] || 'En llamada') : (online ? 'En línea' : 'Desconectado')}
                  </div>
                </div>
                {online && <div className="status-indicator"></div>}
                <button className="delete-btn" onClick={() => removeFriend(friend)}><X size={12} /></button>
              </div>
            );
          })}
          
          {friends.length === 0 && (
            <div className="empty-state">No tienes amigos añadidos.</div>
          )}
        </div>

        <div className="profile-section">
          {editingName ? (
            <div className="edit-profile">
              <input 
                value={newName} 
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveProfile()}
                autoFocus
              />
              <button onClick={saveProfile}>OK</button>
            </div>
          ) : (
            <div className="profile-info" onClick={() => setEditingName(true)}>
              <div className="avatar">{username[0].toUpperCase()}</div>
              <div className="user-info">
                <div className="user-name">{username}</div>
                <div className="user-status">Pincha para editar</div>
              </div>
              <div className="vol-indicator">
                <div className="vol-bar" style={{ width: `${Math.min(myVolume * 2, 100)}%` }}></div>
              </div>
            </div>
          )}
        </div>
      </aside>

      <main className="main-content">
        <div style={{ textAlign: 'center' }}>
          <h1>WAR Chat</h1>
          <p className="subtitle">Tu espacio privado de voz</p>
        </div>

        <div className="actions">
          <button 
            className={`btn ${inVoice ? 'btn-secondary' : 'btn-primary'}`}
            onClick={toggleVoice}
          >
            {inVoice ? <MicOff size={20} /> : <Mic size={20} />}
            {inVoice ? 'Desconectar' : 'Conecta te'}
          </button>

          <button className="btn btn-secondary" onClick={notifyFriends}>
            <Bell size={20} />
            Avisar
          </button>
        </div>

        {inVoice && (
          <div className="voice-info">
            <div className="status-indicator"></div>
            <span>Estas en el canal de voz</span>
          </div>
        )}

        <div className="online-section">
          <h3>Ahora en la app:</h3>
          <div className="online-chips">
            {users.map((u, i) => (
              <div key={i} className={`online-chip ${u.isConnectedToVoice ? 'active' : ''}`}>
                {u.username} {u.isConnectedToVoice ? '🎙️' : ''}
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: '20px', fontSize: '0.7rem', opacity: 0.6 }}>
          Estado del Servidor: {isSocketConnected ? <span style={{ color: '#10b981' }}>● Conectado</span> : <span style={{ color: '#ef4444' }}>● Desconectado (Despertando...)</span>}
          <div style={{ marginTop: '4px' }}>Consola: Ctrl + Shift + I</div>
        </div>
      </main>

      {/* MODALS */}
      {showAddFriend && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Añadir Amigo</h3>
            <input 
              placeholder="Nombre del amigo..." 
              value={friendNameInput}
              onChange={e => setFriendNameInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addFriend()}
            />
            <div className="modal-actions">
              <button onClick={() => setShowAddFriend(false)}>Cancelar</button>
              <button className="confirm" onClick={addFriend}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="modal-overlay">
          <div className="modal">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
              <h3>Ajustes de Audio</h3>
              <button className="icon-btn" onClick={() => setShowSettings(false)}><X size={18} /></button>
            </div>
            
            <div className="setting-item">
              <label><Mic size={16} /> Micrófono</label>
              <select value={selectedMic} onChange={e => setSelectedMic(e.target.value)}>
                <option value="default">Dispositivo predeterminado</option>
                {devices.filter(d => d.kind === 'audioinput').map(d => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || 'Micrófono desconocido'}</option>
                ))}
              </select>
            </div>

            <div className="setting-item">
              <label><Volume2 size={16} /> Altavoces / Auriculares</label>
              <select value={selectedSpeaker} onChange={e => setSelectedSpeaker(e.target.value)}>
                <option value="default">Dispositivo predeterminado</option>
                {devices.filter(d => d.kind === 'audiooutput').map(d => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || 'Altavoz desconocido'}</option>
                ))}
              </select>
            </div>

            <button 
              className={`test-btn ${isTestingAudio ? 'testing' : ''}`}
              onClick={toggleAudioTest}
            >
              {isTestingAudio ? 'Detener Prueba' : '🎙️ Probar Micro y Altavoz'}
            </button>

            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '20px' }}>
              Pincha en "Probar" para escucharte a ti mismo y confirmar que todo funciona.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
