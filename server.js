const express = require('express');
var app = express();
var http = require('http').createServer(app);

const accountSid = 'AC2f88ec7e4affc514a2aa6d862bb22671';
const authToken = '20f3ad9aa8119b1197b8f31a85f63173';
const client = require('twilio')(accountSid, authToken);

var sqlite3 = require("sqlite3").verbose();
var file = "api.db";
const db = new sqlite3.Database(file);

const session = require('express-session');
const mustacheExpress = require('mustache-express');
app.engine("mustache", mustacheExpress());
app.set('view engine', 'mustache');
app.set('views', __dirname + '/views');
app.use(express.urlencoded({ extended: false }));

app.use(session({
    secret: 'Lab5 Stripe',
    resave: false,
    saveUninitialized: false
}))

var stripe = require('stripe')('sk_test_ry9UvmNefcV4NOtuDDDLBhhp00V9udAmNh');

http.listen(3000, function() {
    console.log("App running at port 3000...");
});

db.serialize(function() {
    db.run("DROP TABLE IF EXISTS users");
    db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, password TEXT NOT NULL, birthday TEXT , phone TEXT, role TEXT, stripeId TEXT, planId TEXT)");
    var sql = "INSERT INTO users (name, email, password, role) VALUES (?,?,?,?)";
    db.run(sql, ['Admin', 'admin@app.com', 'admin', 'admin'], function(error) {
        if (error) {
            console.error(error);
        }
    });
});


app.get('/app', function(req, res) {
    if (!req.session.email) {
        res.render('app');
    } else {
        //display error message
        if (req.session.role == 'customer') {
            res.redirect('/members');
        } else {
            res.redirect('/admin');
        }
    }
});

app.get('/login', function(req, res) {
    if (!req.session.email) {
        var isErrors = false;
        var isAlert = false;
        if (req.session.loginError) {
            isErrors = true;
        }
        if (req.session.successAlert) {
            isAlert = true;
        }
        var TPL = {
            loginError: req.session.loginError,
            error: isErrors,
            successAlert: req.session.successAlert,
            alert: isAlert
        };
        req.session.loginError = "";
        req.session.successAlert = "";
        res.render('login', TPL);
    } else {
        //display error message
        if (req.session.role == 'customer') {
            res.redirect('/members');
        } else {
            res.redirect('/admin');
        }
    }
});

app.post('/login', function(req, res) {
    var sql = "SELECT * FROM users";
    db.all(sql, [], function(err, rows) {
        if (err) {
            console.error(error);
        }
        var flag = false;
        for (var i = 0; i < rows.length; i++) {
            if (req.body.userEmail == rows[i]['email'] && req.body.password == rows[i]['password']) {
                flag = true;
                req.session.email = req.body.userEmail;
                req.session.role = rows[i]['role'];
                if (rows[i]['role'] == 'admin') {
                    res.redirect("/admin");
                } else {
                    req.session.paymentMethod = rows[i]['stripeId'];
                    res.redirect("/members");
                }
            }
        }
        if (!flag) {
            req.session.loginError = "These Credentials Do Not match in our database";
            res.redirect('/login');
        }
    });
});


app.get('/logout', function(req, res) {
    // remove the user session key (effectively logs the user out since this is
    // how our app recognizes whether someone is logged in)
    delete(req.session.email);
    delete(req.session.role);
    delete(req.session.paymentMethod);
    delete(req.session.subscriptionId);
    // redirect the user to the login page
    req.session.successAlert = "Logout Successfully.";
    res.redirect("/login");
});


app.get('/register', function(req, res) {
    //display register page
    if (!req.session.email) {
        res.render('register');
    } else {
        //display error message
        if (req.session.role == 'customer') {
            res.redirect('/members');
        } else {
            res.redirect('/admin');
        }
    }
});

app.post('/register', function(req, res) {
    //get form data and insert into database
    //If successful, generate Random number, send text and save it to session variable and redirect user to verify phone number
    //else redirect to register page
    var data = {
        name: req.body.name,
        email: req.body.userEmail,
        password: req.body.password,
        birthday: req.body.birthDate,
        phone: req.body.phoneNumber,
        role: 'customer'
    }
    var sql = "INSERT INTO users Values (?,?,?,?,?,?,?,?,?)";
    db.run(sql, [null, data.name, data.email, data.password, data.birthday, data.phone, data.role, null, null], function(err) {
        if (err) {
            console.error(err);
            res.redirect('/register');
        } else {
            //create a random code and use Twilio to send it to the provided number
            req.session.email = data.email;
            req.session.role = 'customer';
            var code = Math.floor(100000 + Math.random() * 900000);
            var message = "Account Verification code:\n" + code;
            req.session.code = code;
            client.messages
                .create({ body: message, from: '+12015813971', to: '+1' + data.phone })
                .then(function(message) {
                    console.log("Code: " + code);
                });
            res.redirect('/verify');
        }
    });
});

app.get('/verify', function(req, res) {
    if (req.session.email && req.session.role == 'customer') {
        //show verification form
        var isError = false;
        if (req.session.invalidCode) {
            isError = true;
        }
        var TPL = {
            error: isError,
            message: req.session.invalidCode
        }
        req.session.invalidCode = "";
        res.render('verify', TPL);
    } else {
        res.redirect('/login');
    }
});


app.post('/verify', function(req, res) {
    //if the entered code is correct, proceed to members page
    //else redirect to verify
    if (req.session.code == req.body.verifyCode) {
        //verification successful
        //Ask customer to select a plan and add a payment method
        delete(req.session.code);
        res.redirect('/subscription');
    } else {
        //need to add error as well that entered code is incorrect
        req.session.invalidCode = "Invalid Code! Try Again";
        res.redirect('/verify');
    }
});

app.get('/subscription', function(req, res) {
    if (!req.session.email) {
        //Redirect to login page
        res.redirect('/login');
    } else {
        //Render Subscription Page
        if (req.session.paymentMethod) {
            res.redirect('/members');
        } else {
            res.render('subscriptions');
        }
    }
});

app.post('/subscription', function(req, res) {
    //use the stripe token to create a Stripe Customer Object
    var paymentMethodId = req.body.stripeToken;
    //use the stripeToken to create payment Method and then attacthing that payment method to a customer
    createCustomer(paymentMethodId, req.session.email).then(function(id) {
        //save the customer into database
        var sql = "UPDATE users SET stripeId = ? WHERE email = ?";
        db.run(sql, [id, req.session.email], function(err) {
            if (err) {
                console.error(err);
            }
            var productId = "";
            switch (parseInt(req.body.plan)) {
                case 10:
                    productId = "plan_GHX5zkA617D5te"; //Stripe Basic Plan id
                    break;
                case 20:
                    productId = "plan_GHX7D53BClhOOW"; //Stripe Plus Plan id
                    break;
                case 30:
                    productId = "plan_GHX8bWBvtRMDss"; //Stripe Advanced Plan id
                    break;
            }
            createSubscription(id, productId).then(function(result) {
                req.session.paymentMethod = id;
                var sql = "UPDATE users SET planId = ? WHERE email = ?";
                db.run(sql, [productId, req.session.email], function(err) {
                    if (err) {
                        console.error(err);
                    }
                    res.redirect('/members');
                });
            }).catch(function(err) {
                console.log(err);
            });
        });

    });

});

app.get('/members', function(req, res) {
    if (req.session.email && req.session.role == 'customer') {
        //User Has porvided Correct Credentials
        if (req.session.paymentMethod) {
            //Retrieve stripe customer object here and find out which plan current user is on.
            db.all("SELECT * FROM users WHERE email = ?", [req.session.email], function(err, rows) {
                retrieveCustomer(req.session.paymentMethod).then(function(result) {
                    req.session.subscriptionId = result.subscriptions.data[0].id;
                    var planId = result.subscriptions.data[0].plan.id;
                    var basicPlan = false;
                    var plusPlan = false;
                    var advancedPlan = false;
                    switch (planId) {
                        case "plan_GHX5zkA617D5te":
                            basicPlan = true;
                            break;
                        case "plan_GHX7D53BClhOOW":
                            plusPlan = true;
                            break;
                        case "plan_GHX8bWBvtRMDss":
                            advancedPlan = true;
                            break;
                    }
                    var isError = false;
                    var isAlert = false;
                    if (req.session.successMessage) {
                        isAlert = true;
                    }
                    if (req.session.errorMessage) {
                        isError = true;
                    }
                    var TPL = {
                        name: rows[0]['name'],
                        email: rows[0]['email'],
                        password: rows[0]['password'],
                        birthday: rows[0]['birthday'],
                        phone: parseInt(rows[0]['phone']),
                        basic: basicPlan,
                        plus: plusPlan,
                        advance: advancedPlan,
                        error: isError,
                        alert: isAlert,
                        successAlert: req.session.successMessage,
                        errorMessage: req.session.errorMessage
                    };
                    req.session.errorMessage = "";
                    req.session.successMessage = "";
                    res.render('customer', TPL);
                });
            });
        } else {
            res.redirect('/subscription');
        }
    } else {
        //display error message
        res.redirect('/login');
    }
});

app.post('/editProfile', function(req, res) {
    var sql = "UPDATE users SET password = ?, birthday = ?, phone = ? WHERE email = ?";
    db.run(sql, [req.body.password, req.body.birthDate, req.body.phoneNumber, req.session.email], function(err) {
        if (err) {
            console.error(err);
            req.session.errorMessage = "something went wrong while Saving Your changes";
        }
        //Successful message
        req.session.successMessage = "Saved all the changes to your profile.";
        res.redirect('/members');
    });
});

app.post('/manageSubscriptions', function(req, res) {
    var productId = "";
    var flag = 0;
    switch (parseInt(req.body.plan)) {
        case 10:
            productId = "plan_GHX5zkA617D5te"; //Stripe Basic Plan id
            flag = 1;
            break;
        case 20:
            productId = "plan_GHX7D53BClhOOW"; //Stripe Plus Plan id
            flag = 1;
            break;
        case 30:
            productId = "plan_GHX8bWBvtRMDss"; //Stripe Advanced Plan id
            flag = 1;
            break;
        default:
            //delete customer object
            //delete user from the database
            cancelSubscription(req.session.subscriptionId).then(function(result) {
                if (result.status == "canceled") {
                    var sql = "DELETE FROM users WHERE email = ?";
                    db.run(sql, [req.session.email], function(err) {
                        if (err) {
                            console.error(err);
                        }
                        req.session.successAlert = "Subcsription Cancelled Successfully!";
                        res.redirect('/logout');
                    });
                } else {
                    console.log("Couldn't delete customer");
                }
            });
            break;
    }
    if (flag == 1) {
        changeSubscription(req.session.subscriptionId, productId).then(function(result) {
            var sql = "UPDATE users SET planId = ? WHERE email = ?";
            db.run(sql, [productId, req.session.email], function(err) {
                if (err) {
                    console.error(err);
                }
                req.session.successMessage = "Subscription Changed Successfully!";
                res.redirect('/members');
            });
            //res.redirect('/members');
        }).catch(function(err) {
            console.error(err);
        });
    }

});

app.post('/updatePaymentMethod', function(req, res) {
    var paymentMethodId = req.body.stripeToken;
    updateCard(paymentMethodId, req.session.paymentMethod).then(function(result) {
        req.session.successMessage = "Payment Method Changed Successfully";
        res.redirect('/members');
    });
});

app.get('/admin', function(req, res) {
    if (req.session.email && req.session.role == 'admin') {
        db.all("SELECT * from users WHERE NOT role = 'admin'", function(err, rows) {
            if (err) {
                console.log(err);
            }
            var users = [];
            for (var i = 0; i < rows.length; i++) {
                var basicPlan = false;
                var plusPlan = false;
                var advancedPlan = false;
                switch (rows[i]['planId']) {
                    case "plan_GHX5zkA617D5te":
                        basicPlan = true;
                        break;
                    case "plan_GHX7D53BClhOOW":
                        plusPlan = true;
                        break;
                    case "plan_GHX8bWBvtRMDss":
                        advancedPlan = true;
                        break;
                }
                var Temp = {
                    id: rows[i]['id'],
                    name: rows[i]['name'],
                    email: rows[i]['email'],
                    phone: rows[i]['phone'],
                    birthday: rows[i]['birthday'],
                    basic: basicPlan,
                    plus: plusPlan,
                    advance: advancedPlan
                }
                users.push(Temp);
            }
            var isAlert = false;
            if (req.session.successMessage) {
                isAlert = true;
            }
            var TPL = {
                users: users,
                alert: isAlert,
                message: req.session.successMessage
            }
            req.session.successMessage = "";
            res.render('admin', TPL);
        });
    } else {
        //display error message
        res.redirect('/login');
    }
});

app.get('/adminDashboard/:id/:code', function(req, res) {
    if (req.session.email && req.session.role == 'admin') {
        var userId = req.params.id;
        db.all("SELECT * FROM users WHERE id = ?", [userId], function(err, rows) {
            if (err) {
                console.error(err);
            }
            var stripeId = rows[0]['stripeId'];
            retrieveCustomer(stripeId).then(function(result) {
                var productId = "";
                var flag = 0;
                var subscriptionId = result.subscriptions.data[0].id;
                switch (parseInt(req.params.code)) {
                    case 10:
                        productId = "plan_GHX5zkA617D5te"; //Stripe Basic Plan id
                        flag = 1;
                        break;
                    case 20:
                        productId = "plan_GHX7D53BClhOOW"; //Stripe Plus Plan id
                        flag = 1;
                        break;
                    case 30:
                        productId = "plan_GHX8bWBvtRMDss"; //Stripe Advanced Plan id
                        flag = 1;
                        break;
                    case 0:
                        //Cancel Subscription and delete customer
                        cancelSubscription(subscriptionId).then(function(result) {
                            if (result.status == "canceled") {
                                var sql = "DELETE FROM users WHERE email = ?";
                                db.run(sql, [rows[0]['email']], function(err) {
                                    if (err) {
                                        console.error(err);
                                    }
                                    req.session.successMessage = "Subcsription Cancelled Successfully!";
                                    res.redirect('/admin');
                                });
                            } else {
                                console.log("Couldn't delete customer");
                            }
                        });
                        break;
                    default:
                        console.log("Didn't Match any Product it");
                        break;
                }
                if (flag) {
                    //change subscription
                    changeSubscription(subscriptionId, productId).then(function(result) {
                        var sql = "UPDATE users SET planId = ? WHERE email = ?";
                        db.run(sql, [productId, rows[0]['email']], function(err) {
                            if (err) {
                                console.error(err);
                            }
                            req.session.successMessage = "Subscription Changed Successfully!";
                            res.redirect('/admin');
                        });
                        //res.redirect('/members');
                    }).catch(function(err) {
                        console.error(err);
                    });
                }

            });
        });
    }
});


async function createCustomer(id, email) {
    const customer = await stripe.customers.create({
        source: id,
        email: email,
    });
    return customer.id;
}

async function retrieveCustomer(id) {
    //get the id of the plan customer is on
    var customer = stripe.customers.retrieve(id);
    return customer;
}

async function updateCard(paymentMethodId, paymentMethod) {
    var temp = await stripe.customers.update(
        paymentMethod, {
            source: paymentMethodId,
        }
    );
    return temp;

}

async function createSubscription(id, productId) {
    const subscription = await stripe.subscriptions.create({
        customer: id,
        items: [{ plan: productId }]
    });
    return subscription;
}

async function changeSubscription(id, productId) {
    const subscription = await stripe.subscriptions.retrieve(id);
    const temp = stripe.subscriptions.update(id, {
        cancel_at_period_end: false,
        items: [{
            id: subscription.items.data[0].id,
            plan: productId,
        }]
    });
    return temp;
}

async function cancelSubscription(id) {
    const temp = stripe.subscriptions.del(id);
    return temp;
}
