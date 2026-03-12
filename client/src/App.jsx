import { Routes, Route } from 'react-router-dom';
import Home from './components/Home';
import Teacher from './components/Teacher';
import Student from './components/Student';
import ClassTeacher from './components/ClassTeacher';
import ClassStudent from './components/ClassStudent';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/teacher" element={<Teacher />} />
      <Route path="/student" element={<Student />} />
      <Route path="/class-teacher" element={<ClassTeacher />} />
      <Route path="/class-student" element={<ClassStudent />} />
    </Routes>
  );
}

export default App;
