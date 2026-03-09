import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Home() {
    const navigate = useNavigate();
    const [joinCode, setJoinCode] = useState('');

    const createRoom = () => {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        navigate(`/teacher?room=${roomId}`);
    };

    const joinRoom = (e) => {
        e.preventDefault();
        if (joinCode.trim()) {
            navigate(`/student?room=${joinCode.toUpperCase()}`);
        }
    };

    return (
        <div style={styles.container}>
            <div style={styles.card}>
                <h1 style={styles.title}>Interactive Whiteboard</h1>

                <div style={styles.section}>
                    <h3>Teacher</h3>
                    <p style={styles.desc}>Start a new whiteboard session for your class.</p>
                    <button style={styles.btnPrimary} onClick={createRoom}>
                        Create New Room
                    </button>
                </div>

                <div style={styles.divider}>
                    <span>OR</span>
                </div>

                <div style={styles.section}>
                    <h3>Student</h3>
                    <p style={styles.desc}>Enter a room code to join an existing session.</p>
                    <form onSubmit={joinRoom} style={styles.form}>
                        <input
                            type="text"
                            placeholder="Room Code (e.g., A1B2C3)"
                            value={joinCode}
                            onChange={(e) => setJoinCode(e.target.value)}
                            style={styles.input}
                        />
                        <button type="submit" style={styles.btnSecondary} disabled={!joinCode.trim()}>
                            Join Room
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}

const styles = {
    container: {
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f3f4f6',
        padding: '1rem',
    },
    card: {
        backgroundColor: 'white',
        padding: '2.5rem',
        borderRadius: '16px',
        boxShadow: '0 10px 25px rgba(0,0,0,0.05)',
        width: '100%',
        maxWidth: '450px',
        textAlign: 'center',
    },
    title: {
        fontSize: '1.75rem',
        fontWeight: 'bold',
        color: '#1f2937',
        marginBottom: '2rem',
    },
    section: {
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
    },
    desc: {
        color: '#6b7280',
        fontSize: '0.9rem',
    },
    btnPrimary: {
        backgroundColor: '#3b82f6',
        color: 'white',
        padding: '0.75rem',
        borderRadius: '8px',
        border: 'none',
        fontWeight: '600',
        cursor: 'pointer',
        fontSize: '1rem',
        transition: 'background-color 0.2s',
    },
    btnSecondary: {
        backgroundColor: '#10b981',
        color: 'white',
        padding: '0.75rem',
        borderRadius: '8px',
        border: 'none',
        fontWeight: '600',
        cursor: 'pointer',
        fontSize: '1rem',
        transition: 'background-color 0.2s',
    },
    divider: {
        margin: '2rem 0',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    },
    form: {
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
    },
    input: {
        padding: '0.75rem',
        borderRadius: '8px',
        border: '1px solid #d1d5db',
        fontSize: '1rem',
        textAlign: 'center',
        textTransform: 'uppercase',
    }
};
