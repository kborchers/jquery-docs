var HOST_NAME = "api.jqueryui.com",
  GIT_DIR = "/var/www/github-jqueryui",
  DOCS_DIR = GIT_DIR + "/docs",
  DB_NAME = "wordpress",
  DB_USER = "wordpress",
  DB_PASSWORD = "changeme",
  SITE_ID = 2,

  exec = require( "child_process" ).exec,
  Futures = require( "futures" ),
  et = require("elementtree"),

  files = [];

Futures.sequence()
  .then( git_pull )
  .then( find_files )
  .then( process_files )
  .then( mysql_update );

function git_pull( next ) {
  console.log( "Doing 'git pull' in '" + GIT_DIR + "'" );
  exec( "git pull", { cwd: GIT_DIR }, function( error, stdout, stderr ) {
    console.log( stdout );
    if ( error !== null ) {
      console.error( error );
      process.exit( error.code );
    }
    next();
  });
}

function find_files( next ) {
  var finder = require( "findit" ).find( DOCS_DIR );

  finder.on( "file", function( file ) {
    if ( file.split( "." ).slice( -1 )[ 0 ].toLowerCase() === "xml" ) {
      files.push({ path: file });
    }
  });

  finder.on( "end", next );
}

function process_files( next ) {
  var fs = require( "fs" ),
    join = Futures.join();

  files.forEach(function( file ) {
    var filename_ext = file.path.split( "/" ).slice( -1 )[ 0 ],
      filename = filename_ext.split( "." ).slice( 0, -1 ).join( "." ),
      future = Futures.future();

    file.slug = filename;
    file.contents = fs.readFileSync( file.path, "utf8" );

    join.add( future );
    exec( "git log -1 --format=%ci " + file.path, { cwd: GIT_DIR }, function( error, stdout, stderr ) {
      file.commitdate = stdout.split( "\n" )[ 0 ] || (new Date()).toISOString();
      future.deliver( error );
    });
  });

  join.when( next );
}

function mysql_update( next ) {
  var mysql = new require( "mysql" ).createClient(),
    join = Futures.join();

  mysql.user = DB_USER;
  mysql.password = DB_PASSWORD;
  mysql.useDatabase( DB_NAME );

  files.forEach(function( file ) {
    var defer = join.add();
    Futures.sequence()
      .then(function(next) {
        mysql.query( 'SELECT `id` FROM wp_' + SITE_ID + '_posts WHERE `post_name`=? AND `post_type`="post"', [ file.slug ], next );
      })
      .then(function( next, err, results, fields ) {
        if ( results.length ) {
          return next( err, results, fields );
        }
        mysql.query( 'INSERT INTO wp_' + SITE_ID + '_posts (post_author, post_title, post_name, comment_status, ping_status) '
          + ' VALUES (?, ?, ?, "closed", "closed")',
          [ 1, file.slug, file.slug ],
          next);
      })
      .then(function( next, err, results, fields ) {
        var id = results.insertId || results[0].id,
          guid = "http://" + HOST_NAME + "/?p=" + id,
          etree = et.parse(file.contents),
          title = etree.findtext( ".//title" );

        if ( !id ) { return defer(); }

        mysql.query( 'UPDATE wp_' + SITE_ID + '_posts SET `post_title`=?, `post_modified`=?, `post_modified_gmt`=?, '
          + '`post_content`=?, `guid`=? WHERE id=?',
          [ title, file.commitdate, file.commitdate, file.contents, guid, id ],
          defer);
      });
  });

  join.when(function() {
    mysql.end();
    next();
  });
}
