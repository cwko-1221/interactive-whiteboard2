import { Routes, Route } from 'react-router-dom';
import Home from './components/Home';
import Teacher from './components/Teacher';
import Student from './components/Student';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/teacher" element={<Teacher />} />
      <Route path="/student" element={<Student />} />
    </Routes>
  );
}

export default App;
