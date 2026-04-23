import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { Pen, Eraser, Trash2 } from 'lucide-react';
import styles from './ClassStudent.module.css';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export default function ClassStudent() {
    const [searchParams] = useSearchParams();
    const roomId = searchParams.get('room');

    const [name, setName] = useState('');
    const [joined, setJoined] = useState(false);
    const [error, setError] = useState('');

    const [activeTool, setActiveTool] = useState('pen');
    const isDrawing = useRef(false);
    const activePointerId = useRef(null);
    const activeToolRef = useRef(activeTool);

    const bgCanvasRef = useRef(null);   // Background image layer (bottom)
    const canvasRef = useRef(null);      // Drawing layer (top, transparent)
    const contextRef = useRef(null);
    const socketRef = useRef(null);
    const joinedRef = useRef(false);
    const bgImageRef = useRef(null);     // stored HTMLImageElement

    useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
    useEffect(() => { joinedRef.current = joined; }, [joined]);

    // Draw background image onto the BACKGROUND canvas (separate from drawing layer)
    const drawBackground = useCallback(() => {
        const bgCanvas = bgCanvasRef.current;
        if (!bgCanvas || !bgImageRef.current) return;

        const rect = bgCanvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        bgCanvas.width = Math.round(rect.width * dpr);
        bgCanvas.height = Math.round(rect.height * dpr);

        const bgCtx = bgCanvas.getContext('2d');
        bgCtx.scale(dpr, dpr);
        bgCtx.drawImage(bgImageRef.current, 0, 0, rect.width, rect.height);
    }, []);

    // Load and display a background image from base64 data
    const loadAndDrawImage = useCallback((imageData) => {
        if (!imageData) return;
        const img = new Image();
        img.onload = () => {
            bgImageRef.current = img;
            drawBackground();
        };
        img.src = imageData;
    }, [drawBackground]);

    // Initialize Socket and Canvas
    useEffect(() => {
        if (!joined || !roomId) return;

        const socket = io(SERVER_URL);
        socketRef.current = socket;

        socket.on('connect', () => {
            socket.emit('join-room', { roomId, name, isTeacher: false });
        });

        socket.on('error', (msg) => {
            setError(msg);
            setJoined(false);
        });

        // Receive background image from server
        socket.on('room-image', (imageData) => {
            loadAndDrawImage(imageData);
        });

        // Handle teacher clearing ALL boards — only clear the drawing layer
        socket.on('clear-board', () => {
            const ctx = contextRef.current;
            const canvas = canvasRef.current;
            if (ctx && canvas) {
                const rect = canvas.getBoundingClientRect();
                ctx.globalCompositeOperation = 'source-over';
                ctx.clearRect(0, 0, rect.width, rect.height);
                // Background canvas is untouched — image stays visible
            }
        });

        // Setup DRAWING Canvas (transparent — strokes only)
        const canvas = canvasRef.current;
        let handleResize;
        if (canvas) {
            handleResize = () => {
                const rect = canvas.getBoundingClientRect();
                const dpr = window.devicePixelRatio || 1;

                // Save existing drawing before resizing
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = canvas.width;
                tempCanvas.height = canvas.height;
                const tempCtx = tempCanvas.getContext('2d');
                if (canvas.width > 0 && canvas.height > 0) {
                    tempCtx.drawImage(canvas, 0, 0);
                }

                canvas.width = Math.round(rect.width * dpr);
                canvas.height = Math.round(rect.height * dpr);

                const ctx = canvas.getContext('2d');
                ctx.scale(dpr, dpr);
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                contextRef.current = ctx;

                // Restore previous strokes (no background — canvas stays transparent)
                if (tempCanvas.width > 0 && tempCanvas.height > 0) {
                    ctx.drawImage(tempCanvas, 0, 0, rect.width, rect.height);
                }

                // Also resize the background canvas
                drawBackground();
            };

            handleResize();
            window.addEventListener('resize', handleResize);
        }

        return () => {
            if (handleResize) {
                window.removeEventListener('resize', handleResize);
            }
            socket.disconnect();
        };
    }, [joined, roomId, name, drawBackground, loadAndDrawImage]);

    const getCoordinates = useCallback((e) => {
        if (!canvasRef.current) return { x: 0, y: 0 };
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();

        let x, y;

        // Use offsetX/Y if available for pinpoint accuracy
        if (e.offsetX !== undefined && e.offsetY !== undefined) {
            x = e.offsetX;
            y = e.offsetY;
        } else {
            // Fallback for older devices/Safari
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

    // Native event listeners for iPad pen reliability
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const handlePointerDown = (e) => {
            if (e.cancelable) e.preventDefault();

            const isPen = e.pointerType === 'pen' || e.pointerType === 'stylus';

            if (isDrawing.current && activePointerId.current !== null && e.pointerId !== activePointerId.current) {
                if (!isPen) return;
                isDrawing.current = false;
                activePointerId.current = null;
            }

            activePointerId.current = e.pointerId;
            isDrawing.current = true;

            const coords = getCoordinates(e);
            
            const ctx = contextRef.current;
            if (ctx) {
                setupContextMode();
                ctx.beginPath();
                ctx.moveTo(coords.rawX, coords.rawY);
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

        const handleTouchStart = (e) => {
            if (e.touches.length === 1 && e.cancelable) {
                e.preventDefault();
            }
        };

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
            ctx.globalCompositeOperation = 'source-over';
            ctx.clearRect(0, 0, rect.width, rect.height);
            // Only clear strokes — background canvas stays intact
        }
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
                    <h2 className={styles.modalTitle}>Join Class Module</h2>
                    <p className={styles.modalDesc}>
                        Enter your name to start working on the worksheet.
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
                            Start Writing
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            {/* Toolbar */}
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

            {/* Background image canvas (bottom layer) */}
            <canvas
                ref={bgCanvasRef}
                className={styles.bgCanvas}
            />
            {/* Drawing canvas (top layer, transparent) */}
            <canvas
                ref={canvasRef}
                className={styles.canvas}
            />
        </div>
    );
}
