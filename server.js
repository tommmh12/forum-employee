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

// Middleware kiểm tra đăng nhập
const isAuthenticated = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ message: 'Chưa đăng nhập' });
  }
  next();
};

// API Đăng nhập
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
        user: req.session.user
      });
    } else {
      return res.status(401).json({ success: false, message: 'Email hoặc mật khẩu không đúng' });
    }
  });
});

// API Lấy thông tin user
app.get('/api/user', isAuthenticated, (req, res) => {
  const query = `
    SELECT u.UserID, u.EmpID, u.Email, e.FirstName, e.LastName, e.Department, e.ChucVu, u.Role, e.Photo
    FROM Users u
    JOIN Employees e ON u.EmpID = e.EmpID
    WHERE u.UserID = ?
  `;
  db.query(query, [req.session.user.UserID], (err, results) => {
    if (err) {
      console.error('Lỗi truy vấn user:', err);
      return res.status(500).json({ message: 'Lỗi server' });
    }
    res.json(results[0] || {});
  });
});

// API Upload file (hình ảnh)
app.post('/api/upload', isAuthenticated, (req, res) => {
  if (!req.files || !req.files.file) {
    return res.status(400).json({ message: 'Không có file upload' });
  }

  const file = req.files.file;
  const fileName = `file_${req.session.user.EmpID}_${Date.now()}${path.extname(file.name)}`;
  const uploadPath = path.join(__dirname, 'uploads', fileName);

  file.mv(uploadPath, (err) => {
    if (err) {
      console.error('Lỗi upload file:', err);
      return res.status(500).json({ message: 'Lỗi upload file' });
    }

    res.json({ 
      success: true, 
      fileName: fileName,
      message: 'Upload file thành công' 
    });
  });
});

// API Bài viết
app.get('/api/posts', isAuthenticated, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 5;
  const search = req.query.search || '';
  const offset = (page - 1) * limit;

  const searchQuery = search ? `%${search}%` : '%';
  const countQuery = `
    SELECT COUNT(*) as total 
    FROM PostDetailsView p
    WHERE p.Title LIKE ? OR p.Content LIKE ?
  `;
  const query = `
    SELECT p.*, 
    (SELECT COUNT(*) FROM Comments c WHERE c.PostID = p.PostID) as commentCount,
    (SELECT LikeStatus FROM Likes_Dislikes ld WHERE ld.PostID = p.PostID AND ld.EmpID = ?) as userLikeStatus
    FROM PostDetailsView p
    WHERE p.Title LIKE ? OR p.Content LIKE ?
    ORDER BY p.PostedDate DESC
    LIMIT ? OFFSET ?
  `;

  db.query(countQuery, [searchQuery, searchQuery], (err, countResult) => {
    if (err) {
      console.error('Lỗi đếm bài viết:', err);
      return res.status(500).json({ message: 'Lỗi server' });
    }

    const total = countResult[0].total;
    db.query(query, [req.session.user.EmpID, searchQuery, searchQuery, limit, offset], (err, results) => {
      if (err) {
        console.error('Lỗi lấy bài viết:', err);
        return res.status(500).json({ message: 'Lỗi server' });
      }

      const posts = results.map(post => ({
        ...post,
        userLikeStatus: post.userLikeStatus === null ? null : Boolean(post.userLikeStatus)
      }));

      res.json({
        posts: posts,
        total: total
      });
    });
  });
});

app.post('/api/posts', isAuthenticated, (req, res) => {
  const { title, content, imageURL } = req.body;
  const empId = req.session.user.EmpID;

  const query = `
    INSERT INTO Posts (Title, Content, ImageURL, PostedDate, EmpID, Views, Likes, Status) 
    VALUES (?, ?, ?, NOW(), ?, 0, 0, 'Công khai')
  `;
  db.query(query, [title, content, imageURL, empId], (err, result) => {
    if (err) {
      console.error('Lỗi thêm bài viết:', err);
      return res.status(500).json({ message: 'Lỗi server' });
    }
    
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

app.put('/api/posts/:id', isAuthenticated, (req, res) => {
  const postId = req.params.id;
  const { title, content, imageURL } = req.body;
  const empId = req.session.user.EmpID;

  const query = `
    UPDATE Posts 
    SET Title = ?, Content = ?, ImageURL = ?, PostedDate = NOW()
    WHERE PostID = ? AND EmpID = ?
  `;
  db.query(query, [title, content, imageURL, postId, empId], (err, result) => {
    if (err) {
      console.error('Lỗi cập nhật bài viết:', err);
      return res.status(500).json({ message: 'Lỗi server' });
    }

    if (result.affectedRows === 0) {
      return res.status(403).json({ message: 'Không có quyền chỉnh sửa hoặc bài viết không tồn tại' });
    }

    const getQuery = `
      SELECT p.*, e.FirstName, e.LastName, e.Photo, e.Department, e.ChucVu
      FROM Posts p
      JOIN Employees e ON p.EmpID = e.EmpID
      WHERE p.PostID = ?
    `;
    db.query(getQuery, [postId], (err, updatedPost) => {
      if (err) {
        console.error('Lỗi lấy bài viết đã cập nhật:', err);
        return res.status(500).json({ message: 'Lỗi server' });
      }
      res.json(updatedPost[0]);
    });
  });
});

app.delete('/api/posts/:id', isAuthenticated, (req, res) => {
  const postId = req.params.id;
  const user = req.session.user;

  const checkQuery = 'SELECT EmpID, Department FROM Posts p JOIN Employees e ON p.EmpID = e.EmpID WHERE PostID = ?';
  db.query(checkQuery, [postId], (err, results) => {
    if (err) {
      console.error('Lỗi kiểm tra bài viết:', err);
      return res.status(500).json({ message: 'Lỗi server' });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: 'Bài viết không tồn tại' });
    }

    const post = results[0];
    if (user.Role === 'Manager' && user.Department === post.Department) {
      const deleteQuery = 'DELETE FROM Posts WHERE PostID = ?';
      db.query(deleteQuery, [postId], (err) => {
        if (err) {
          console.error('Lỗi xóa bài viết:', err);
          return res.status(500).json({ message: 'Lỗi server' });
        }
        res.json({ success: true, message: 'Xóa bài viết thành công' });
      });
    } else if (post.EmpID === user.EmpID) {
      res.status(403).json({ message: 'Nhân viên chỉ có thể gửi yêu cầu xóa' });
    } else {
      res.status(403).json({ message: 'Không có quyền xóa bài viết này' });
    }
  });
});

// API Like/Dislike bài viết
app.post('/api/posts/:id/like-dislike', isAuthenticated, (req, res) => {
  const postId = req.params.id;
  const empId = req.session.user.EmpID;
  const { likeStatus } = req.body; // TRUE for like, FALSE for dislike

  const checkQuery = 'SELECT * FROM Likes_Dislikes WHERE PostID = ? AND EmpID = ? AND CommentID IS NULL';
  db.query(checkQuery, [postId, empId], (err, results) => {
    if (err) {
      console.error('Lỗi kiểm tra lượt like/dislike:', err);
      return res.status(500).json({ message: 'Lỗi server' });
    }

    if (results.length > 0) {
      // Người dùng đã like/dislike trước đó
      const currentStatus = results[0].LikeStatus;
      if (currentStatus === likeStatus) {
        // Xóa lượt like/dislike nếu cùng trạng thái
        const deleteQuery = 'DELETE FROM Likes_Dislikes WHERE PostID = ? AND EmpID = ? AND CommentID IS NULL';
        db.query(deleteQuery, [postId, empId], (err) => {
          if (err) {
            console.error('Lỗi xóa lượt like/dislike:', err);
            return res.status(500).json({ message: 'Lỗi server' });
          }
          const getCountsQuery = 'SELECT Likes, Dislikes FROM PostDetailsView WHERE PostID = ?';
          db.query(getCountsQuery, [postId], (err, counts) => {
            if (err) {
              console.error('Lỗi lấy số lượt like/dislike:', err);
              return res.status(500).json({ message: 'Lỗi server' });
            }
            res.json({ userLikeStatus: null, likes: counts[0].Likes, dislikes: counts[0].Dislikes });
          });
        });
      } else {
        // Cập nhật trạng thái like/dislike
        const updateQuery = 'UPDATE Likes_Dislikes SET LikeStatus = ? WHERE PostID = ? AND EmpID = ? AND CommentID IS NULL';
        db.query(updateQuery, [likeStatus, postId, empId], (err) => {
          if (err) {
            console.error('Lỗi cập nhật lượt like/dislike:', err);
            return res.status(500).json({ message: 'Lỗi server' });
          }
          const getCountsQuery = 'SELECT Likes, Dislikes FROM PostDetailsView WHERE PostID = ?';
          db.query(getCountsQuery, [postId], (err, counts) => {
            if (err) {
              console.error('Lỗi lấy số lượt like/dislike:', err);
              return res.status(500).json({ message: 'Lỗi server' });
            }
            res.json({ userLikeStatus: likeStatus, likes: counts[0].Likes, dislikes: counts[0].Dislikes });
          });
        });
      }
    } else {
      // Người dùng chưa like/dislike, thêm mới
      const insertQuery = 'INSERT INTO Likes_Dislikes (EmpID, PostID, CommentID, LikeStatus) VALUES (?, ?, NULL, ?)';
      db.query(insertQuery, [empId, postId, likeStatus], (err) => {
        if (err) {
          console.error('Lỗi thêm lượt like/dislike:', err);
          return res.status(500).json({ message: 'Lỗi server' });
        }
        const getCountsQuery = 'SELECT Likes, Dislikes FROM PostDetailsView WHERE PostID = ?';
        db.query(getCountsQuery, [postId], (err, counts) => {
          if (err) {
            console.error('Lỗi lấy số lượt like/dislike:', err);
            return res.status(500).json({ message: 'Lỗi server' });
          }
          res.json({ userLikeStatus: likeStatus, likes: counts[0].Likes, dislikes: counts[0].Dislikes });
        });
      });
    }
  });
});

// API Bình luận
app.get('/api/comments/:postId', isAuthenticated, (req, res) => {
  const postId = req.params.postId;
  const query = `
    SELECT c.*, 
    (SELECT LikeStatus FROM Likes_Dislikes ld WHERE ld.CommentID = c.CommentID AND ld.EmpID = ?) as userLikeStatus
    FROM CommentDetailsView c
    WHERE c.PostID = ?
    ORDER BY c.CommentDate ASC
  `;
  db.query(query, [req.session.user.EmpID, postId], (err, results) => {
    if (err) {
      console.error('Lỗi lấy bình luận:', err);
      return res.status(500).json({ message: 'Lỗi server' });
    }
    const comments = results.map(comment => ({
      ...comment,
      userLikeStatus: comment.userLikeStatus === null ? null : Boolean(comment.userLikeStatus)
    }));
    res.json(comments);
  });
});

app.post('/api/comments', isAuthenticated, (req, res) => {
  const { postId, content, imageURL } = req.body;
  const empId = req.session.user.EmpID;

  const query = `
    INSERT INTO Comments (PostID, EmpID, Content, ImageURL, CommentDate) 
    VALUES (?, ?, ?, ?, NOW())
  `;
  db.query(query, [postId, empId, content, imageURL], (err, result) => {
    if (err) {
      console.error('Lỗi thêm bình luận:', err);
      return res.status(500).json({ message: 'Lỗi server' });
    }
    
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

app.put('/api/comments/:id', isAuthenticated, (req, res) => {
  const commentId = req.params.id;
  const { content, imageURL } = req.body;
  const empId = req.session.user.EmpID;

  const query = `
    UPDATE Comments 
    SET Content = ?, ImageURL = ?, CommentDate = NOW()
    WHERE CommentID = ? AND EmpID = ?
  `;
  db.query(query, [content, imageURL, commentId, empId], (err, result) => {
    if (err) {
      console.error('Lỗi cập nhật bình luận:', err);
      return res.status(500).json({ message: 'Lỗi server' });
    }

    if (result.affectedRows === 0) {
      return res.status(403).json({ message: 'Không có quyền chỉnh sửa hoặc bình luận không tồn tại' });
    }

    const getQuery = `
      SELECT c.*, e.FirstName, e.LastName, e.Photo
      FROM Comments c
      JOIN Employees e ON c.EmpID = e.EmpID
      WHERE c.CommentID = ?
    `;
    db.query(getQuery, [commentId], (err, updatedComment) => {
      if (err) {
        console.error('Lỗi lấy bình luận đã cập nhật:', err);
        return res.status(500).json({ message: 'Lỗi server' });
      }
      res.json(updatedComment[0]);
    });
  });
});

app.delete('/api/comments/:id', isAuthenticated, (req, res) => {
  const commentId = req.params.id;
  const user = req.session.user;

  const checkQuery = 'SELECT EmpID, Department, ChucVu FROM Comments c JOIN Employees e ON c.EmpID = e.EmpID WHERE CommentID = ?';
  db.query(checkQuery, [commentId], (err, results) => {
    if (err) {
      console.error('Lỗi kiểm tra bình luận:', err);
      return res.status(500).json({ message: 'Lỗi server' });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: 'Bình luận không tồn tại' });
    }

    const comment = results[0];
    if (user.Role === 'Manager' && user.ChucVu === comment.ChucVu) {
      const deleteQuery = 'DELETE FROM Comments WHERE CommentID = ?';
      db.query(deleteQuery, [commentId], (err) => {
        if (err) {
          console.error('Lỗi xóa bình luận:', err);
          return res.status(500).json({ message: 'Lỗi server' });
        }
        res.json({ success: true, message: 'Xóa bình luận thành công' });
      });
    } else if (comment.EmpID === user.EmpID) {
      res.status(403).json({ message: 'Nhân viên chỉ có thể gửi yêu cầu xóa' });
    } else {
      res.status(403).json({ message: 'Không có quyền xóa bình luận này' });
    }
  });
});

// API Like/Dislike bình luận
app.post('/api/comments/:id/like-dislike', isAuthenticated, (req, res) => {
  const commentId = req.params.id;
  const empId = req.session.user.EmpID;
  const { likeStatus } = req.body;

  const checkQuery = 'SELECT * FROM Likes_Dislikes WHERE CommentID = ? AND EmpID = ? AND PostID IS NULL';
  db.query(checkQuery, [commentId, empId], (err, results) => {
    if (err) {
      console.error('Lỗi kiểm tra lượt like/dislike:', err);
      return res.status(500).json({ message: 'Lỗi server' });
    }

    if (results.length > 0) {
      const currentStatus = results[0].LikeStatus;
      if (currentStatus === likeStatus) {
        const deleteQuery = 'DELETE FROM Likes_Dislikes WHERE CommentID = ? AND EmpID = ? AND PostID IS NULL';
        db.query(deleteQuery, [commentId, empId], (err) => {
          if (err) {
            console.error('Lỗi xóa lượt like/dislike:', err);
            return res.status(500).json({ message: 'Lỗi server' });
          }
          const getCountsQuery = 'SELECT Likes, Dislikes FROM CommentDetailsView WHERE CommentID = ?';
          db.query(getCountsQuery, [commentId], (err, counts) => {
            if (err) {
              console.error('Lỗi lấy số lượt like/dislike:', err);
              return res.status(500).json({ message: 'Lỗi server' });
            }
            res.json({ userLikeStatus: null, likes: counts[0].Likes, dislikes: counts[0].Dislikes });
          });
        });
      } else {
        const updateQuery = 'UPDATE Likes_Dislikes SET LikeStatus = ? WHERE CommentID = ? AND EmpID = ? AND PostID IS NULL';
        db.query(updateQuery, [likeStatus, commentId, empId], (err) => {
          if (err) {
            console.error('Lỗi cập nhật lượt like/dislike:', err);
            return res.status(500).json({ message: 'Lỗi server' });
          }
          const getCountsQuery = 'SELECT Likes, Dislikes FROM CommentDetailsView WHERE CommentID = ?';
          db.query(getCountsQuery, [commentId], (err, counts) => {
            if (err) {
              console.error('Lỗi lấy số lượt like/dislike:', err);
              return res.status(500).json({ message: 'Lỗi server' });
            }
            res.json({ userLikeStatus: likeStatus, likes: counts[0].Likes, dislikes: counts[0].Dislikes });
          });
        });
      }
    } else {
      const insertQuery = 'INSERT INTO Likes_Dislikes (EmpID, PostID, CommentID, LikeStatus) VALUES (?, NULL, ?, ?)';
      db.query(insertQuery, [empId, commentId, likeStatus], (err) => {
        if (err) {
          console.error('Lỗi thêm lượt like/dislike:', err);
          return res.status(500).json({ message: 'Lỗi server' });
        }
        const getCountsQuery = 'SELECT Likes, Dislikes FROM CommentDetailsView WHERE CommentID = ?';
        db.query(getCountsQuery, [commentId], (err, counts) => {
          if (err) {
            console.error('Lỗi lấy số lượt like/dislike:', err);
            return res.status(500).json({ message: 'Lỗi server' });
          }
          res.json({ userLikeStatus: likeStatus, likes: counts[0].Likes, dislikes: counts[0].Dislikes });
        });
      });
    }
  });
});

// API Thông tin nhân viên
app.get('/api/employees', isAuthenticated, (req, res) => {
  const empId = req.query.empId;

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
      res.json(results);
    });
    return;
  }

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

app.put('/api/employees/:empId', isAuthenticated, (req, res) => {
  if (req.session.user.Role !== 'Manager') {
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

app.get('/employee-info', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'employee-info.html'));
});

app.listen(port, () => {
  console.log(`Server đang chạy tại http://localhost:${port}`);
});