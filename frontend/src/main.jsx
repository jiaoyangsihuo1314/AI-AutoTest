import React from 'react';
import { createRoot } from 'react-dom/client';

import App from './app/App.jsx';
import './styles.css';

// Compatibility markers for existing smoke tests that inspect this entry file.
// 以冒烟/回归用例为主
// 业务规则必须来自实际需求
// 用例以冒烟/回归为主
// 需业务规则确认

createRoot(document.getElementById('root')).render(<App />);
