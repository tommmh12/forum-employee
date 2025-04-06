const mysql = require('mysql');

const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '123456',
    database: 'EmployeeManagement'
});

db.connect(err => {
    if (err) {
        console.error('Không thể kết nối đến MySQL:', err);
        return;
    }
    console.log('Đã kết nối đến MySQL');

    db.query('SELECT * FROM postdetailsview', (err, results) => {
        if (err) {
            console.error('Lỗi khi lấy bài viết:', err);
            return;
        }
        console.log('Bài viết:', results);
    });
});