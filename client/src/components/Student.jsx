import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { Pen, Eraser, Trash2 } from 'lucide-react';
import styles from './Student.module.css';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export default function Student() {
    const [searchParams] = useSearchParams();
    const roomId = searchParams.get('room');

    const [name, setName] = useState('');
    const [joined, setJoined] = useState(false);
    const [error, setError] = useState('');

    const [activeTool, setActiveTool] = useState('pen'); // 'pen' | 'eraser'
    const isDrawing = useRef(false);
    const activePointerId = useRef(null);
    const activeToolRef = useRef(activeTool);

    const canvasRef = useRef(null);
    const contextRef = useRef(null);
    const socketRef = useRef(null);
    const joinedRef = useRef(false);

    // Keep refs in sync with state
    useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
    useEffect(() => { joinedRef.current = joined; }, [joined]);

    // Initialize Socket and Canvas context when joined
    useEffect(() => {
        if (!joined || !roomId) return;

        socketRef.current = io(SERVER_URL);

        socketRef.current.on('connect', () => {
            socketRef.current.emit('join-room', { roomId, name, isTeacher: false });
        });

        socketRef.current.on('error', (msg) => {
            setError(msg);
            setJoined(false);
        });

        // Listen for teacher clearing all boards
        socketRef.current.on('clear-board', () => {
            const ctx = contextRef.current;
            const canvas = canvasRef.current;
            if (ctx && canvas) {
                const rect = canvas.getBoundingClientRect();
                ctx.clearRect(0, 0, rect.width, rect.height);
            }
        });

        // Setup Canvas
        const canvas = canvasRef.current;
        if (canvas) {
            const handleResize = () => {
                const rect = canvas.getBoundingClientRect();
                const dpr = window.devicePixelRatio || 1;
                canvas.width = rect.width * dpr;
                canvas.height = rect.height * dpr;

                const ctx = canvas.getContext('2d');
                ctx.scale(dpr, dpr);
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                contextRef.current = ctx;
            };

            handleResize();
            window.addEventListener('resize', handleResize);
            return () => {
                window.removeEventListener('resize', handleResize);
                if (socketRef.current) socketRef.current.disconnect();
            };
        }
    }, [joined, roomId, name]);

    const getCoordinates = useCallback((e) => {
        if (!canvasRef.current) return { x: 0, y: 0 };
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();

        // Use offsetX/Y if available (most reliable for direct element relative coords)
        // Some older browsers/devices might not provide these in pointer events consistently
        let x, y;

        if (e.offsetX !== undefined && e.offsetY !== undefined) {
            x = e.offsetX;
            y = e.offsetY;
        } else {
            // Fallback for older iOS Safari
            const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
            const clientY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
            x = clientX - rect.left;
            y = clientY - rect.top;
        }

        return {
            x: x / rect.width,
            y: y / rect.height,
            rawX: x,
            rawY: y
        };
    }, []);

    const setupContextMode = useCallback(() => {
        const ctx = contextRef.current;
        if (!ctx) return;

        if (activeToolRef.current === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = 20;
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 3;
        }
    }, []);

    const emitDrawEvent = useCallback((state, point) => {
        if (socketRef.current && joinedRef.current) {
            socketRef.current.emit('draw', {
                x: point.x,
                y: point.y,
                state,
                color: '#000000',
                size: activeToolRef.current === 'eraser' ? 10 : 1.5,
                isEraser: activeToolRef.current === 'eraser'
            });
        }
    }, []);

    // ── Native event listeners for reliable iPad pen input ──
    // React's synthetic events can delay preventDefault(), causing iPadOS Safari
    // to claim the gesture (scroll/zoom) before our handler runs.
    // Using addEventListener with { passive: false } ensures we block the
    // browser's gesture recognizer immediately on the first pointerdown.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        let lastX = 0;
        let lastY = 0;

        const handlePointerDown = (e) => {
            // Always prevent default immediately to stop Safari gesture recognition
            if (e.cancelable) e.preventDefault();

            const isPen = e.pointerType === 'pen' || e.pointerType === 'stylus';

            // If already drawing with another pointer, only let a pen take over
            if (isDrawing.current && activePointerId.current !== null && e.pointerId !== activePointerId.current) {
                if (!isPen) return;
                isDrawing.current = false;
                activePointerId.current = null;
            }

            activePointerId.current = e.pointerId;
            isDrawing.current = true;

            const coords = getCoordinates(e);
            lastX = coords.rawX;
            lastY = coords.rawY;

            const ctx = contextRef.current;
            if (ctx) {
                setupContextMode();
                ctx.beginPath();
                ctx.moveTo(lastX, lastY);
            }

            emitDrawEvent('start', coords);
        };

        const handlePointerMove = (e) => {
            if (!isDrawing.current) return;
            if (e.pointerId !== undefined && activePointerId.current !== null && e.pointerId !== activePointerId.current) return;

            if (e.cancelable) e.preventDefault();

            const coords = getCoordinates(e);
            const ctx = contextRef.current;
            if (ctx) {
                ctx.lineTo(coords.rawX, coords.rawY);
                ctx.stroke();
            }

            emitDrawEvent('move', coords);
        };

        const handlePointerUp = (e) => {
            if (!isDrawing.current) return;
            if (e.pointerId !== undefined && activePointerId.current !== null && e.pointerId !== activePointerId.current) return;

            if (e.cancelable) e.preventDefault();

            isDrawing.current = false;
            activePointerId.current = null;

            const coords = getCoordinates(e);
            emitDrawEvent('end', coords);
        };

        // Block Safari's gesture recognizer at the touch level too
        const handleTouchStart = (e) => {
            // Only prevent default if a single touch (pen or finger drawing),
            // don't block multi-touch (pinch zoom if needed later)
            if (e.touches.length === 1 && e.cancelable) {
                e.preventDefault();
            }
        };

        // All listeners MUST be { passive: false } so preventDefault() works on iOS
        canvas.addEventListener('pointerdown', handlePointerDown, { passive: false });
        canvas.addEventListener('pointermove', handlePointerMove, { passive: false });
        canvas.addEventListener('pointerup', handlePointerUp, { passive: false });
        canvas.addEventListener('pointerleave', handlePointerUp, { passive: false });
        canvas.addEventListener('pointercancel', handlePointerUp, { passive: false });
        canvas.addEventListener('touchstart', handleTouchStart, { passive: false });

        return () => {
            canvas.removeEventListener('pointerdown', handlePointerDown);
            canvas.removeEventListener('pointermove', handlePointerMove);
            canvas.removeEventListener('pointerup', handlePointerUp);
            canvas.removeEventListener('pointerleave', handlePointerUp);
            canvas.removeEventListener('pointercancel', handlePointerUp);
            canvas.removeEventListener('touchstart', handleTouchStart);
        };
    }, [joined, getCoordinates, setupContextMode, emitDrawEvent]);

    const [clearProgress, setClearProgress] = useState(0);

    const clearCanvas = () => {
        const ctx = contextRef.current;
        const canvas = canvasRef.current;
        if (ctx && canvas) {
            const rect = canvas.getBoundingClientRect();
            ctx.clearRect(0, 0, rect.width, rect.height);
        }
        // Notify server so teacher's view of this student is cleared
        if (socketRef.current) {
            socketRef.current.emit('student-clear');
        }
        setClearProgress(0); // Reset slider
    };

    const handleClearSliderChange = (e) => {
        const val = parseInt(e.target.value);
        setClearProgress(val);
        if (val >= 100) {
            clearCanvas();
        }
    };

    const handleClearSliderRelease = () => {
        if (clearProgress < 100) {
            setClearProgress(0);
        }
    };

    if (!roomId) {
        return <div style={{ padding: '2rem', textAlign: 'center' }}>No Room ID provided. Please scan a valid QR code or enter via Home page.</div>;
    }

    if (!joined) {
        return (
            <div className={styles.joinContainer}>
                <div className={styles.joinCard}>
                    <div className={styles.roomBadgeWrapper}>
                        <span className={styles.roomBadge}>Room: {roomId}</span>
                    </div>
                    <h2 className={styles.modalTitle}>Join Whiteboard</h2>
                    <p className={styles.modalDesc}>
                        Enter your name to start drawing with your class.
                    </p>

                    <form onSubmit={(e) => {
                        e.preventDefault();
                        if (name.trim()) setJoined(true);
                    }}>
                        <input
                            type="text"
                            className={styles.inputField}
                            placeholder="Your full name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            autoFocus
                        />
                        {error && <p style={{ color: '#ef4444', marginBottom: '1rem', fontSize: '0.875rem' }}>{error}</p>}
                        <button
                            type="submit"
                            className={styles.joinBtn}
                            disabled={!name.trim()}
                        >
                            Start Drawing
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            {/* Toolbar - Floating */}
            <div className={styles.toolbar}>
                <button
                    className={`${styles.toolBtn} ${activeTool === 'pen' ? styles.active : ''}`}
                    onClick={() => setActiveTool('pen')}
                    title="Pen"
                >
                    <Pen size={20} />
                </button>
                <button
                    className={`${styles.toolBtn} ${activeTool === 'eraser' ? styles.active : ''}`}
                    onClick={() => setActiveTool('eraser')}
                    title="Eraser"
                >
                    <Eraser size={20} />
                </button>

                <div className={styles.divider}></div>

                {/* Slide to Clear */}
                <div className={styles.sliderContainer} title="Slide to Clear All">
                    <div className={styles.sliderTrack}>
                        <div 
                            className={styles.sliderFill} 
                            style={{ width: `${clearProgress}%`, opacity: clearProgress / 100 }}
                        ></div>
                        <input
                            type="range"
                            min="0"
                            max="100"
                            value={clearProgress}
                            onChange={handleClearSliderChange}
                            onMouseUp={handleClearSliderRelease}
                            onTouchEnd={handleClearSliderRelease}
                            className={styles.clearSlider}
                        />
                        <div className={styles.sliderLabel} style={{ opacity: 1 - (clearProgress / 50) }}>
                             Slide to Clear
                        </div>
                    </div>
                    <div className={styles.sliderIcon}>
                        <Trash2 size={16} color={clearProgress > 90 ? "#ef4444" : "#9ca3af"} />
                    </div>
                </div>
            </div>

            {/* Canvas — event listeners attached natively via useEffect above */}
            <canvas
                ref={canvasRef}
                className={styles.canvas}
            />
        </div>
    );
}
