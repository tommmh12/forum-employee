const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const fileUpload = require('express-fileupload');
const fs = require('fs');

const app = express();
const port = 3000;

// Tạo thư mục uploads nếu chưa có
if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
}

// Kết nối MySQL
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '123456',
  database: 'EmployeeManagement'
});

db.connect(err => {
  if (err) {
    console.error('Lỗi kết nối MySQL:', err);
    process.exit(1);
  }
  console.log('Đã kết nối MySQL');
});

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(fileUpload());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(session({
  secret: 'forum_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// API Đăng nhập (không mã hóa)
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  const query = `
    SELECT u.*, e.* 
    FROM Users u
    JOIN Employees e ON u.EmpID = e.EmpID
    WHERE u.Email = ? AND u.PasswordHash = ?
  `;
  
  db.query(query, [email, password], (err, results) => {
    if (err) {
      console.error('Lỗi đăng nhập:', err);
      return res.status(500).json({ success: false, message: 'Lỗi server' });
    }

    if (results.length > 0) {
      const user = results[0];
      req.session.user = {
        UserID: user.UserID,
        EmpID: user.EmpID,
        Email: user.Email,
        FirstName: user.FirstName,
        LastName: user.LastName,
        Role: user.Role,
        Photo: user.Photo,
        Department: user.Department,
        ChucVu: user.ChucVu
      };
      
      return res.json({ 
        success: true, 
        message: 'Đăng nhập thành công',
        user: results[0]
      });
    } else {
      return res.status(401).json({ success: false, message: 'Email hoặc mật khẩu không đúng' });
    }
  });
});

// API Lấy thông tin user
app.get('/api/user', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ message: 'Chưa đăng nhập' });
  }

  const query = 'SELECT * FROM AccountDetailsView WHERE UserID = ?';
  db.query(query, [req.session.user.UserID], (err, results) => {
    if (err) {
      console.error('Lỗi truy vấn user:', err);
      return res.status(500).json({ message: 'Lỗi server' });
    }
    res.json(results[0] || {});
  });
});

// API Bài viết
app.get('/api/posts', (req, res) => {
  const query = `
    SELECT p.*, e.FirstName, e.LastName, e.Photo, e.Department, e.ChucVu,
    (SELECT COUNT(*) FROM Comments c WHERE c.PostID = p.PostID) as commentCount
    FROM Posts p
    JOIN Employees e ON p.EmpID = e.EmpID
    ORDER BY p.PostedDate DESC
  `;
  db.query(query, (err, results) => {
    if (err) {
      console.error('Lỗi lấy bài viết:', err);
      return res.status(500).json({ message: 'Lỗi server' });
    }
    res.json(results);
  });
});

app.post('/api/posts', (req, res) => {
  if (!req.session.user) {
    return res.status(403).json({ message: 'Chưa đăng nhập' });
  }

  const { title, content } = req.body;
  const empId = req.session.user.EmpID;

  const query = 'INSERT INTO Posts (Title, Content, EmpID, PostedDate) VALUES (?, ?, ?, NOW())';
  db.query(query, [title, content, empId], (err, result) => {
    if (err) {
      console.error('Lỗi thêm bài viết:', err);
      return res.status(500).json({ message: 'Lỗi server' });
    }
    
    // Lấy lại bài viết vừa tạo để trả về client
    const getQuery = `
      SELECT p.*, e.FirstName, e.LastName, e.Photo, e.Department, e.ChucVu, 0 as commentCount
      FROM Posts p
      JOIN Employees e ON p.EmpID = e.EmpID
      WHERE p.PostID = ?
    `;
    db.query(getQuery, [result.insertId], (err, newPost) => {
      if (err) {
        console.error('Lỗi lấy bài viết mới:', err);
        return res.status(500).json({ message: 'Lỗi server' });
      }
      res.json({ 
        success: true,
        post: newPost[0],
        message: 'Đã thêm bài viết' 
      });
    });
  });
});

// API Bình luận
app.get('/api/comments/:postId', (req, res) => {
  const postId = req.params.postId;
  const query = `
    SELECT c.*, e.FirstName, e.LastName, e.Photo
    FROM Comments c
    JOIN Employees e ON c.EmpID = e.EmpID
    WHERE c.PostID = ?
    ORDER BY c.CommentDate ASC
  `;
  db.query(query, [postId], (err, results) => {
    if (err) {
      console.error('Lỗi lấy bình luận:', err);
      return res.status(500).json({ message: 'Lỗi server' });
    }
    res.json(results);
  });
});

app.post('/api/comments', (req, res) => {
  if (!req.session.user) {
    return res.status(403).json({ message: 'Chưa đăng nhập' });
  }

  const { postId, content } = req.body;
  const empId = req.session.user.EmpID;

  const query = 'INSERT INTO Comments (PostID, EmpID, Content, CommentDate) VALUES (?, ?, ?, NOW())';
  db.query(query, [postId, empId, content], (err, result) => {
    if (err) {
      console.error('Lỗi thêm bình luận:', err);
      return res.status(500).json({ message: 'Lỗi server' });
    }
    
    // Lấy lại bình luận vừa tạo
    const getQuery = `
      SELECT c.*, e.FirstName, e.LastName, e.Photo
      FROM Comments c
      JOIN Employees e ON c.EmpID = e.EmpID
      WHERE c.CommentID = ?
    `;
    db.query(getQuery, [result.insertId], (err, newComment) => {
      if (err) {
        console.error('Lỗi lấy bình luận mới:', err);
        return res.status(500).json({ message: 'Lỗi server' });
      }
      res.json({ 
        success: true,
        comment: newComment[0],
        message: 'Đã thêm bình luận' 
      });
    });
  });
});

// API Thông tin nhân viên
app.get('/api/employees', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ message: 'Chưa đăng nhập' });
  }

  const empId = req.query.empId; // Lấy empId từ query string

  // Nếu có empId, trả về thông tin của nhân viên cụ thể
  if (empId) {
    const query = 'SELECT * FROM Employees WHERE EmpID = ?';
    db.query(query, [empId], (err, results) => {
      if (err) {
        console.error('Lỗi truy vấn nhân viên:', err);
        return res.status(500).json({ message: 'Lỗi server' });
      }
      if (results.length === 0) {
        return res.status(404).json({ message: 'Không tìm thấy nhân viên' });
      }
      res.json(results); // Trả về mảng chứa thông tin nhân viên
    });
    return;
  }

  // Nếu không có empId, trả về danh sách nhân viên theo vai trò
  if (req.session.user.Role === 'Employee') {
    const query = 'SELECT * FROM Employees WHERE EmpID = ?';
    db.query(query, [req.session.user.EmpID], (err, results) => {
      if (err) {
        console.error('Lỗi truy vấn nhân viên:', err);
        return res.status(500).json({ message: 'Lỗi server' });
      }
      res.json(results);
    });
  } else if (req.session.user.Role === 'Manager') {
    const query = 'SELECT * FROM Employees WHERE Department = ?';
    db.query(query, [req.session.user.Department], (err, results) => {
      if (err) {
        console.error('Lỗi truy vấn nhân viên:', err);
        return res.status(500).json({ message: 'Lỗi server' });
      }
      res.json(results);
    });
  } else {
    res.status(403).json({ message: 'Không có quyền truy cập' });
  }
});

// API Cập nhật thông tin nhân viên
app.put('/api/employees/:empId', (req, res) => {
  if (!req.session.user || req.session.user.Role !== 'Manager') {
    return res.status(403).json({ message: 'Chỉ trưởng phòng được cập nhật' });
  }

  const { FirstName, LastName, Telephone, Address_loc } = req.body;
  const empId = req.params.empId;

  const query = `
    UPDATE Employees 
    SET FirstName = ?, LastName = ?, Telephone = ?, Address_loc = ?
    WHERE EmpID = ? AND Department = ?
  `;
  
  db.query(query, [
    FirstName, 
    LastName, 
    Telephone, 
    Address_loc, 
    empId,
    req.session.user.Department
  ], (err, result) => {
    if (err) {
      console.error('Lỗi cập nhật nhân viên:', err);
      return res.status(500).json({ message: 'Lỗi server' });
    }
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Không tìm thấy nhân viên hoặc không có quyền' });
    }
    
    res.json({ success: true, message: 'Cập nhật thành công' });
  });
});

// Thêm route mới cho trang thông tin nhân viên
app.get('/employee-info', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'employee-info.html'));
});

// API Upload ảnh đại diện
app.post('/api/upload', (req, res) => {
  if (!req.session.user) {
    return res.status(403).json({ message: 'Chưa đăng nhập' });
  }

  if (!req.files || !req.files.file) {
    return res.status(400).json({ message: 'Không có file upload' });
  }

  const file = req.files.file;
  const fileName = `avatar_${req.session.user.EmpID}_${Date.now()}${path.extname(file.name)}`;
  const uploadPath = path.join(__dirname, 'uploads', fileName);

  file.mv(uploadPath, (err) => {
    if (err) {
      console.error('Lỗi upload file:', err);
      return res.status(500).json({ message: 'Lỗi upload file' });
    }

    // Cập nhật vào database
    const updateQuery = 'UPDATE Employees SET Photo = ? WHERE EmpID = ?';
    db.query(updateQuery, [fileName, req.session.user.EmpID], (err) => {
      if (err) {
        console.error('Lỗi cập nhật ảnh:', err);
        return res.status(500).json({ message: 'Lỗi cập nhật database' });
      }
      
      // Cập nhật session
      req.session.user.Photo = fileName;
      
      res.json({ 
        success: true, 
        fileName: fileName,
        message: 'Upload ảnh đại diện thành công' 
      });
    });
  });
});


// API Đăng xuất
app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Lỗi đăng xuất:', err);
      return res.status(500).json({ message: 'Lỗi server' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true, message: 'Đã đăng xuất' });
  });
});

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/forum', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'forum.html'));
});

app.listen(port, () => {
  console.log(`Server đang chạy tại http://localhost:${port}`);
});